/**
 * tests/integration/tenant-invitations.test.ts
 *
 * Tests for the tenant invitation flow:
 *   POST /api/admin/tenants/[tenantId]/invite
 *   GET  /api/invite/peek
 *   POST /api/invite/accept
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

// ── Constants ──────────────────────────────────────────────────────────────────

const ORG_ID    = 'org-inv-test-001';
const USER_ID   = 'user-inv-admin-001';
const TENANT_ID = 'tenant-inv-test-001';
const TENANT_EMAIL = 'tenant@example.com';
const RAW_TOKEN = 'test-raw-token-256bits-base64url-placeholder';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// ── Shared mock state ──────────────────────────────────────────────────────────

interface TenantRow {
  id: string;
  org_id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  profile_id: string | null;
  portal_access: string;
}

interface InvitationRow {
  id: string;
  org_id: string;
  tenant_id: string;
  email: string;
  token_hash: string;
  invited_by: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
}

interface ProfileRow {
  id: string;
  org_id: string;
  role: string;
}

const state = {
  requireAdminError: false,
  requireAdminForbidden: false,

  tenants: {} as Record<string, TenantRow>,
  invitations: {} as Record<string, InvitationRow>,
  profiles: {} as Record<string, ProfileRow>,

  // session user for accept tests
  sessionUser: null as { id: string; email: string } | null,
  sessionError: false,

  // controls for email sending
  resendKeySet: false,

  nextInviteId: 1,
};

// ── vi.mock: auth guards ──────────────────────────────────────────────────────

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (state.requireAdminError) throw new Error('UNAUTHORIZED');
    if (state.requireAdminForbidden) throw new Error('FORBIDDEN');
    return { userId: USER_ID, orgId: ORG_ID, role: 'admin', profile: {} };
  }),
}));

// ── vi.mock: @/auth — used by invite/accept/route.ts (NextAuth session) ──────

vi.mock('@/auth', () => ({
  auth: vi.fn().mockImplementation(async () => {
    if (state.sessionError || !state.sessionUser) return null;
    return { user: { id: state.sessionUser.id, email: state.sessionUser.email } };
  }),
}));

// ── vi.mock: @/lib/db ────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => {
  // Inline helper — must be inside the factory to avoid vi.mock hoisting issues
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  // Extract a simple string value from a Drizzle SQL condition (recursively walks queryChunks)
  function extractValueFromCondition(cond: unknown): string | null {
    if (!cond || typeof cond !== 'object') return null;
    const obj = cond as Record<string, unknown>;
    // Drizzle eq() has left/right or queryChunks
    if (obj['queryChunks'] && Array.isArray(obj['queryChunks'])) {
      for (const chunk of obj['queryChunks']) {
        const v = extractValueFromCondition(chunk);
        if (v) return v;
      }
    }
    if (typeof obj['value'] === 'string') return obj['value'];
    if (obj['right']) {
      const v = extractValueFromCondition(obj['right']);
      if (v) return v;
    }
    return null;
  }

  function makeSelect() {
    let tableName = '';
    let whereFilterHash: string | null = null;
    const chain = {
      from: vi.fn((tableRef: unknown) => {
        tableName = getTableName(tableRef);
        return chain;
      }),
      where: vi.fn((cond?: unknown) => {
        whereFilterHash = extractValueFromCondition(cond);
        return chain;
      }),
      innerJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => {
        if (tableName === 'tenant_invitations') {
          const all = Object.values(state.invitations).map(inv => ({
            id: inv.id, orgId: inv.org_id, tenantId: inv.tenant_id,
            email: inv.email, status: inv.status,
            expiresAt: inv.expires_at, tokenHash: inv.token_hash,
          }));
          // If we captured a hash filter, match against tokenHash
          if (whereFilterHash) {
            const matched = all.filter(r => r.tokenHash === whereFilterHash);
            if (matched.length > 0) return matched;
            return []; // No match → route will return 404
          }
          return all;
        }
        if (tableName === 'tenants') {
          return Object.values(state.tenants).map(t => ({
            id: t.id, orgId: t.org_id, email: t.email, profileId: null, photoUrl: null,
          }));
        }
        if (tableName === 'profiles') {
          return Object.values(state.profiles).map(p => ({
            id: p.id, orgId: p.org_id, role: p.role, userId: p.id,
          }));
        }
        if (tableName === 'organizations') {
          return [{ name: 'Propiedades Demo SA' }];
        }
        return [];
      }),
    };
    return chain;
  }

  function makeUpdate(tableRef: unknown) {
    const tableName = getTableName(tableRef);
    let setPayload: Record<string, unknown> = {};
    const chain = {
      set: vi.fn((payload: Record<string, unknown>) => {
        setPayload = payload;
        return chain;
      }),
      where: vi.fn(() => {
        // Apply update to all rows (can't filter by Drizzle condition)
        if (tableName === 'tenant_invitations') {
          for (const inv of Object.values(state.invitations)) {
            if (setPayload['status'] !== undefined) inv.status = String(setPayload['status']);
            if (setPayload['acceptedAt'] !== undefined) inv.accepted_at = new Date().toISOString();
          }
        }
        if (tableName === 'tenants') {
          for (const t of Object.values(state.tenants)) {
            if (setPayload['portalAccess'] !== undefined) t.portal_access = String(setPayload['portalAccess']);
            if (setPayload['profileId'] !== undefined) t.profile_id = String(setPayload['profileId']);
          }
        }
        // Return a thenable chain that also supports .returning()
        const whereResult: Record<string, unknown> = {
          returning: vi.fn(async () => {
            // Used in accept route: .returning({ id: tenants.id })
            if (tableName === 'tenants') return Object.values(state.tenants).map(t => ({ id: t.id }));
            return [];
          }),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        };
        return whereResult;
      }),
      returning: vi.fn(async () => {
        // Used in accept route: .returning({ id: tenants.id })
        return Object.values(state.tenants).map(t => ({ id: t.id }));
      }),
    };
    return chain;
  }

  function makeInsert(tableRef: unknown) {
    const tableName = getTableName(tableRef);
    const chain = {
      values: vi.fn((vals: Record<string, unknown>) => {
        if (tableName === 'tenant_invitations') {
          const id = `inv-${state.nextInviteId++}`;
          state.invitations[id] = {
            id,
            org_id: String(vals['orgId'] ?? ''),
            tenant_id: String(vals['tenantId'] ?? ''),
            email: String(vals['email'] ?? ''),
            token_hash: String(vals['tokenHash'] ?? ''),
            invited_by: String(vals['invitedBy'] ?? ''),
            status: String(vals['status'] ?? 'pending'),
            expires_at: vals['expiresAt'] instanceof Date
              ? vals['expiresAt'].toISOString()
              : String(vals['expiresAt'] ?? new Date().toISOString()),
            accepted_at: null,
          };
        }
        if (tableName === 'profiles') {
          const p = vals as Record<string, unknown>;
          const id = String(p['userId'] ?? p['id'] ?? '');
          if (id) state.profiles[id] = { id, org_id: String(p['orgId'] ?? ''), role: String(p['role'] ?? 'tenant') };
        }
        return { returning: vi.fn(async () => []) };
      }),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn(async () => []),
    };
    return chain;
  }

  return {
    db: {
      select: () => makeSelect(),
      update: (tableRef: unknown) => makeUpdate(tableRef),
      insert: (tableRef: unknown) => makeInsert(tableRef),
      query: { profiles: { findFirst: vi.fn(async () => null) } },
    },
  };
});

// ── vi.mock: email + env + log ────────────────────────────────────────────────

vi.mock('@/lib/notifications/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('fake-key'),
  env: { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'fake-key' },
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    authSuccess: vi.fn(), authFailure: vi.fn(),
  },
}));

// ── Import route handlers AFTER all vi.mock() calls ──────────────────────────

import { POST as invitePost }  from '@/app/api/admin/tenants/[tenantId]/invite/route';
import { GET  as peekGet }     from '@/app/api/invite/peek/route';
import { POST as acceptPost }  from '@/app/api/invite/accept/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInviteRequest(tenantId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/tenants/${tenantId}/invite`, {
    method: 'POST',
  });
}

function makePeekRequest(token: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/invite/peek?token=${token}`);
}

function makeAcceptRequest(token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/invite/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  state.requireAdminError = false;
  state.requireAdminForbidden = false;
  state.sessionUser = null;
  state.sessionError = false;
  state.resendKeySet = false;
  state.nextInviteId = 1;

  for (const k of Object.keys(state.tenants))     delete state.tenants[k];
  for (const k of Object.keys(state.invitations)) delete state.invitations[k];
  for (const k of Object.keys(state.profiles))    delete state.profiles[k];

  // Seed a default tenant with email
  state.tenants[TENANT_ID] = {
    id:           TENANT_ID,
    org_id:       ORG_ID,
    email:        TENANT_EMAIL,
    first_name:   'Ana',
    last_name:    'García',
    profile_id:   null,
    portal_access: 'not_invited',
  };

  // Env var — unset RESEND_API_KEY by default
  delete process.env['RESEND_API_KEY'];
  process.env['NEXT_PUBLIC_SITE_URL'] = 'http://localhost:3000';
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/admin/tenants/[tenantId]/invite
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/tenants/[tenantId]/invite', () => {

  it('happy path: creates invitation, sets portal_access=invited, returns inviteUrl + expiresAt', async () => {
    const res = await invitePost(makeInviteRequest(TENANT_ID), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as { invited: boolean; inviteUrl: string; expiresAt: string };
    expect(body.invited).toBe(true);
    expect(body.inviteUrl).toMatch(/\/invite\/accept\?token=/);
    expect(body.expiresAt).toBeTruthy();

    // portal_access set to 'invited'
    expect(state.tenants[TENANT_ID].portal_access).toBe('invited');

    // invitation row created
    const inv = Object.values(state.invitations)[0];
    expect(inv).toBeDefined();
    expect(inv.status).toBe('pending');
    expect(inv.email).toBe(TENANT_EMAIL);
    expect(inv.tenant_id).toBe(TENANT_ID);
    expect(inv.org_id).toBe(ORG_ID);
  });

  it('prior pending invitations are revoked before creating a new one', async () => {
    // Seed an existing pending invitation
    const oldHash = sha256('old-token-value');
    state.invitations['inv-old'] = {
      id:         'inv-old',
      org_id:     ORG_ID,
      tenant_id:  TENANT_ID,
      email:      TENANT_EMAIL,
      token_hash: oldHash,
      invited_by: USER_ID,
      status:     'pending',
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      accepted_at: null,
    };

    const res = await invitePost(makeInviteRequest(TENANT_ID), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    });
    expect(res.status).toBe(200);

    // Old invitation must be revoked
    expect(state.invitations['inv-old'].status).toBe('revoked');
  });

  it('non-admin → 401', async () => {
    state.requireAdminError = true;
    const res = await invitePost(makeInviteRequest(TENANT_ID), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('tenant without email → 400 (or 422)', async () => {
    state.tenants[TENANT_ID].email = null;
    const res = await invitePost(makeInviteRequest(TENANT_ID), {
      params: Promise.resolve({ tenantId: TENANT_ID }),
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NO_EMAIL');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/invite/peek
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/invite/peek', () => {

  beforeEach(() => {
    // Seed a valid pending invitation for peek tests
    const tokenHash = sha256(RAW_TOKEN);
    state.invitations['inv-peek'] = {
      id:          'inv-peek',
      org_id:      ORG_ID,
      tenant_id:   TENANT_ID,
      email:       TENANT_EMAIL,
      token_hash:  tokenHash,
      invited_by:  USER_ID,
      status:      'pending',
      expires_at:  new Date(Date.now() + 7 * 86400_000).toISOString(),
      accepted_at: null,
    };
  });

  it('valid pending token → returns maskedEmail + orgName', async () => {
    const res = await peekGet(makePeekRequest(RAW_TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json() as { maskedEmail: string; orgName: string };
    expect(body.maskedEmail).toMatch(/\*\*\*@/);
    expect(body.orgName).toBeTruthy();
  });

  it('unknown token → 404', async () => {
    const res = await peekGet(makePeekRequest('totally-unknown-token-xyz'));
    expect(res.status).toBe(404);
  });

  it('accepted token → 410 with generic message', async () => {
    state.invitations['inv-peek'].status = 'accepted';
    const res = await peekGet(makePeekRequest(RAW_TOKEN));
    expect(res.status).toBe(410);
    const body = await res.json() as { error: { message: string } };
    // NB1: same generic message regardless of accepted vs expired
    expect(body.error.message).toBe('Esta invitación ha vencido o ya no es válida.');
  });

  it('expired token (by status) → 410 with same generic message', async () => {
    state.invitations['inv-peek'].status = 'expired';
    const res = await peekGet(makePeekRequest(RAW_TOKEN));
    expect(res.status).toBe(410);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toBe('Esta invitación ha vencido o ya no es válida.');
  });

  it('pending but past expires_at → 410', async () => {
    state.invitations['inv-peek'].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await peekGet(makePeekRequest(RAW_TOKEN));
    expect(res.status).toBe(410);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/invite/accept
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/invite/accept', () => {

  const TOKEN_HASH = sha256(RAW_TOKEN);

  beforeEach(() => {
    // Default session user matching invitation email
    state.sessionUser = { id: 'auth-user-accept-001', email: TENANT_EMAIL };

    // Seed a pending invitation
    state.invitations['inv-accept'] = {
      id:          'inv-accept',
      org_id:      ORG_ID,
      tenant_id:   TENANT_ID,
      email:       TENANT_EMAIL,
      token_hash:  TOKEN_HASH,
      invited_by:  USER_ID,
      status:      'pending',
      expires_at:  new Date(Date.now() + 7 * 86400_000).toISOString(),
      accepted_at: null,
    };
  });

  it('happy path: profile created, tenant linked, portal_access=active, invitation accepted', async () => {
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(200);

    const body = await res.json() as { accepted: boolean; redirectTo: string };
    expect(body.accepted).toBe(true);
    expect(body.redirectTo).toBe('/portal');

    // profile created
    expect(state.profiles['auth-user-accept-001']).toBeDefined();
    expect(state.profiles['auth-user-accept-001'].role).toBe('tenant');

    // tenant linked
    expect(state.tenants[TENANT_ID].profile_id).toBe('auth-user-accept-001');
    expect(state.tenants[TENANT_ID].portal_access).toBe('active');

    // invitation accepted
    expect(state.invitations['inv-accept'].status).toBe('accepted');
  });

  it('does NOT create a new tenant row — links existing only', async () => {
    const tenantCountBefore = Object.keys(state.tenants).length;
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(200);
    expect(Object.keys(state.tenants).length).toBe(tenantCountBefore);
  });

  it('existing profile in same org → still links tenant successfully', async () => {
    // Pre-seed existing profile
    state.profiles['auth-user-accept-001'] = {
      id:     'auth-user-accept-001',
      org_id: ORG_ID,
      role:   'tenant',
    };
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  it('expired token → 410 and status flipped to expired', async () => {
    state.invitations['inv-accept'].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(410);
    expect(state.invitations['inv-accept'].status).toBe('expired');
  });

  it('session email ≠ invitation email → 403', async () => {
    state.sessionUser = { id: 'auth-user-other', email: 'different@other.com' };
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('EMAIL_MISMATCH');
  });

  it('already accepted token → 409', async () => {
    state.invitations['inv-accept'].status = 'accepted';
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(409);
  });

  it('revoked token → 409', async () => {
    state.invitations['inv-accept'].status = 'revoked';
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(409);
  });

  it('unauthenticated (no session) → 401', async () => {
    state.sessionError = true;
    const res = await acceptPost(makeAcceptRequest(RAW_TOKEN));
    expect(res.status).toBe(401);
  });
});
