/**
 * tests/integration/airtable-org-binding-routes.test.ts
 *
 * SA-1 / SA-5 — the Airtable integration is bound to a single org.
 *
 * Covers:
 *   - cron syncs ONLY the bound org (never every organization)
 *   - cron with no bound org syncs nothing and returns ok
 *   - admin sync route: bound org → runs, other org → 403 AIRTABLE_NOT_ENABLED
 *   - admin status route: other org → not-configured status
 *   - tenant/register: other org → 403, admin role → 403, rate limit → 429
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret-org-binding';
const BOUND_ORG = '00000000-0000-0000-0000-0000000000aa';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

process.env['CRON_SECRET'] = CRON_SECRET;
process.env['AIRTABLE_PAT'] = 'pat.org_binding_test_token';
process.env['AIRTABLE_BASE_ID'] = 'appORGBINDINGTEST';
process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const state = {
  boundOrgId: BOUND_ORG as string | null,
  session: { orgId: BOUND_ORG, role: 'admin' as 'admin' | 'tenant' },
  allOrgIds: [BOUND_ORG, OTHER_ORG],
  rateLimitOk: true,
};

const syncEntityTable = vi.fn(async (_orgId: string, entity: string) => ({
  entity,
  count: 1,
  skippedLinks: 0,
  status: 'success',
}));
const syncAirtableTable = vi.fn();
const upsertAirtableResidente = vi.fn();
const dbInsert = vi.fn();
const dbExecute = vi.fn(async () => ({ count: 0 }));
const fetchSpy = vi.fn();

vi.mock('@/lib/airtable/org-binding', () => ({
  getAirtableOrgId: vi.fn(async () => state.boundOrgId),
  isAirtableOrg: vi.fn(async (orgId: string) => state.boundOrgId !== null && orgId === state.boundOrgId),
  AIRTABLE_NOT_ENABLED_ERROR: {
    error: { code: 'AIRTABLE_NOT_ENABLED', message: 'Airtable integration is not enabled for this organization.' },
  },
}));

vi.mock('@/lib/airtable/sync-entities', () => ({
  syncEntityTable: (...args: [string, string]) => syncEntityTable(...args),
}));
vi.mock('@/lib/airtable/sync', () => ({
  syncAirtableTable: (...args: unknown[]) => syncAirtableTable(...args),
}));
vi.mock('@/lib/airtable/client', () => ({ getAirtableClient: vi.fn(() => ({})) }));
vi.mock('@/lib/airtable/write', () => ({
  upsertAirtableResidente: (...args: unknown[]) => upsertAirtableResidente(...args),
}));
vi.mock('@/lib/agent/listings', () => ({
  syncListingsFromUnits: vi.fn(async () => ({ inserted: 0, updated: 0 })),
}));

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({
    userId: 'user-1',
    orgId: state.session.orgId,
    role: 'admin',
    profile: {},
  })),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('@/lib/ratelimit', () => ({
  getClientIp: vi.fn(() => '203.0.113.7'),
  actionRateLimit: vi.fn(() => ({ success: state.rateLimitOk, retryAfterMs: 0 })),
}));

vi.mock('@/lib/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain['from'] = () => chain;
    chain['where'] = () => chain;
    chain['limit'] = () => Promise.resolve([{ id: 'profile-1', orgId: state.session.orgId, role: state.session.role }]);
    return chain;
  };
  return {
    db: {
      select: () => selectChain(),
      insert: (...args: unknown[]) => dbInsert(...args),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      execute: () => dbExecute(),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cronRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/airtable-sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.boundOrgId = BOUND_ORG;
  state.session = { orgId: BOUND_ORG, role: 'admin' };
  state.rateLimitOk = true;
  vi.stubGlobal('fetch', fetchSpy);
});

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

describe('cron/airtable-sync — org binding', () => {
  it('syncs only the bound org even when other organizations exist', async () => {
    const { POST } = await import('@/app/api/cron/airtable-sync/route');
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);

    const orgsSynced = new Set(syncEntityTable.mock.calls.map(c => c[0]));
    expect(orgsSynced).toEqual(new Set([BOUND_ORG]));
    expect(orgsSynced.has(OTHER_ORG)).toBe(false);

    const body = await res.json();
    const resultOrgs = new Set((body.entityResults as Array<{ orgId: string }>).map(r => r.orgId));
    expect(resultOrgs).toEqual(new Set([BOUND_ORG]));
  });

  it('syncs nothing and returns ok when no org is bound', async () => {
    state.boundOrgId = null;
    const { POST } = await import('@/app/api/cron/airtable-sync/route');
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', snapshotResults: [], entityResults: [] });
    expect(syncEntityTable).not.toHaveBeenCalled();
    expect(syncAirtableTable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin sync / status
// ---------------------------------------------------------------------------

describe('admin Airtable routes — org binding', () => {
  it('sync: admin of the bound org runs the sync', async () => {
    const { POST } = await import('@/app/api/admin/integrations/airtable/sync/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/integrations/airtable/sync', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(syncEntityTable).toHaveBeenCalled();
    expect(syncEntityTable.mock.calls.every(c => c[0] === BOUND_ORG)).toBe(true);
  });

  it('sync: admin of another org gets 403 AIRTABLE_NOT_ENABLED and nothing is synced', async () => {
    state.session = { orgId: OTHER_ORG, role: 'admin' };
    const { POST } = await import('@/app/api/admin/integrations/airtable/sync/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/integrations/airtable/sync', { method: 'POST' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('AIRTABLE_NOT_ENABLED');
    expect(syncEntityTable).not.toHaveBeenCalled();
  });

  it('status: admin of another org gets a not-configured status without base details', async () => {
    state.session = { orgId: OTHER_ORG, role: 'admin' };
    const { GET } = await import('@/app/api/admin/integrations/airtable/status/route');
    const res = await GET(new NextRequest('http://localhost/api/admin/integrations/airtable/status'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.base_id).toBeNull();
    expect(body.base_name).toBeNull();
    expect(body.connectivity.connected).toBe(false);
    expect(body.env_vars.every((v: { configured: boolean }) => v.configured === false)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tenant/register
// ---------------------------------------------------------------------------

describe('tenant/register — org binding (SA-5)', () => {
  const validBody = {
    first_name: 'Ana',
    last_name: 'Perez',
    email: 'ana@example.com',
    phone: '+51999999999',
    dni: '12345678',
    birth_date: '1990-01-01',
    terms_accepted: true,
    privacy_accepted: true,
  };

  function registerRequest(): NextRequest {
    return new NextRequest('http://localhost/api/tenant/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
  }

  it('returns 403 for a tenant of another org and never touches Airtable or the DB insert', async () => {
    state.session = { orgId: OTHER_ORG, role: 'tenant' };
    const { POST } = await import('@/app/api/tenant/register/route');
    const res = await POST(registerRequest());
    expect(res.status).toBe(403);
    expect(dbInsert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 for an admin of the bound org (admins use /api/admin/tenants)', async () => {
    state.session = { orgId: BOUND_ORG, role: 'admin' };
    const { POST } = await import('@/app/api/tenant/register/route');
    const res = await POST(registerRequest());
    expect(res.status).toBe(403);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    state.rateLimitOk = false;
    const { POST } = await import('@/app/api/tenant/register/route');
    const res = await POST(registerRequest());
    expect(res.status).toBe(429);
    expect(dbInsert).not.toHaveBeenCalled();
  });
});
