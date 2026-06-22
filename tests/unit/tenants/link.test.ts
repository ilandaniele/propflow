/**
 * Unit tests for linkTenantPortalAccount and searchAuthUserByEmail Server Actions (Drizzle version).
 *
 * Covers:
 * 1. Zod schema validation on linkTenantPortalAccount (tenantId uuid, profileEmail email)
 * 2. IDOR guard: tenant not in admin's org → NOT_FOUND
 * 3. Already-linked tenant → CONFLICT
 * 4. Profile email not found → NOT_FOUND
 * 5. Happy path: tenants.profile_id set + audit log written
 * 6. Unauthorized call → UNAUTHORIZED
 * 7. Rate limiting blocks after threshold
 * 8. searchAuthUserByEmail queries profiles table by email
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Valid UUIDs used throughout tests
const TENANT_UUID = '550e8400-e29b-41d4-a716-446655440001';
const AUTH_USER_UUID = '550e8400-e29b-41d4-a716-446655440002';
const ORG_UUID = '550e8400-e29b-41d4-a716-446655440003';

// ─── Shared mock state ────────────────────────────────────────────────────────

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
  tenantRow: null as { id: string; orgId: string; profileId: string | null } | null,
  profileRow: null as { id: string; role: string } | null,
  dbUpdateError: false,
};

// ─── Mock: @/lib/db ──────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    query: { profiles: { findFirst: vi.fn(async () => null) } },
  },
}));

function getTableName(tableRef: unknown): string {
  if (!tableRef || typeof tableRef !== 'object') return '';
  const syms = Object.getOwnPropertySymbols(tableRef as object);
  const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
  return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
}

function setupSelectChains() {
  mockDbSelect.mockImplementation(() => {
    let tableName = '';

    function resolveForTable(): unknown[] {
      if (tableName === 'profiles') return mockState.profileRow ? [mockState.profileRow] : [];
      if (tableName === 'tenants')  return mockState.tenantRow  ? [mockState.tenantRow]  : [];
      return [];
    }

    // `where()` must both:
    //  - be awaitable (for searchAuthUserByEmail which does `await db.select().from().where()`)
    //  - support `.limit()` chaining (for linkTenantPortalAccount)
    const makeWhere = () => {
      const result = resolveForTable();
      const whereObj: {
        then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => void;
        limit: (n: number) => Promise<unknown[]>;
      } = {
        then: (resolve: (v: unknown[]) => void) => resolve(result),
        limit: vi.fn(async () => result),
      };
      return whereObj;
    };

    const chain = {
      from: vi.fn((tableRef: unknown) => {
        tableName = getTableName(tableRef);
        return chain;
      }),
      where: vi.fn(() => makeWhere()),
    };
    return chain;
  });
}

function setupUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(async () => {
      if (mockState.dbUpdateError) throw new Error('DB update error');
      return [];
    }),
  };
  mockDbUpdate.mockReturnValue(chain);
}

function setupInsertChain() {
  const chain = {
    values: vi.fn(() => ({
      catch: vi.fn(async () => []),
    })),
    catch: vi.fn().mockReturnThis(),
  };
  mockDbInsert.mockReturnValue(chain);
}

// ─── Mock: @/lib/auth/guards ──────────────────────────────────────────────────

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    adminAction: vi.fn(), authSuccess: vi.fn(), authFailure: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { linkTenantPortalAccount, searchAuthUserByEmail } from '@/app/actions/tenants';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.set(k, v));
  return f;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockState.tenantRow = { id: TENANT_UUID, orgId: ORG_UUID, profileId: null };
  mockState.profileRow = { id: AUTH_USER_UUID, role: 'tenant' };
  mockState.dbUpdateError = false;

  setupSelectChains();
  setupUpdateChain();
  setupInsertChain();
});

// ─── linkTenantPortalAccount ──────────────────────────────────────────────────

describe('linkTenantPortalAccount', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns RATE_LIMITED when rate limit exceeded', async () => {
    mockState.rateLimitSuccess = false;
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('RATE_LIMITED');
  });

  it('returns VALIDATION_ERROR for invalid tenantId (not a UUID)', async () => {
    const result = await linkTenantPortalAccount({}, fd({ tenantId: 'not-a-uuid', profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR for invalid profileEmail', async () => {
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'not-an-email' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND when tenant not in org (IDOR guard)', async () => {
    mockState.tenantRow = null;
    setupSelectChains();
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when tenant already has a profile_id set', async () => {
    mockState.tenantRow = { id: TENANT_UUID, orgId: ORG_UUID, profileId: AUTH_USER_UUID };
    setupSelectChains();
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('CONFLICT');
  });

  it('returns NOT_FOUND when profile with that email does not exist', async () => {
    mockState.profileRow = null;
    setupSelectChains();
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'nobody@example.com' }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('happy path: links tenant, returns ok({ profileId })', async () => {
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.profileId).toBe(AUTH_USER_UUID);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it('happy path: is case-insensitive for email matching', async () => {
    // The action normalizes email to lowercase before querying
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'TENANT@EXAMPLE.COM' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.profileId).toBe(AUTH_USER_UUID);
  });

  it('returns INTERNAL when db update fails', async () => {
    mockState.dbUpdateError = true;
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ─── searchAuthUserByEmail ────────────────────────────────────────────────────

describe('searchAuthUserByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.adminRole = 'admin';
    mockState.rateLimitSuccess = true;
    mockState.profileRow = { id: AUTH_USER_UUID, role: 'tenant' };
    setupSelectChains();
    setupUpdateChain();
    setupInsertChain();
  });

  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await searchAuthUserByEmail({}, fd({ email: 'find@example.com' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for non-email input', async () => {
    const result = await searchAuthUserByEmail({}, fd({ email: 'not-valid' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns ok with empty matches when no profile found', async () => {
    mockState.profileRow = null;
    setupSelectChains();
    const result = await searchAuthUserByEmail({}, fd({ email: 'nobody@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.matches).toEqual([]);
  });

  it('returns matched user when found by email', async () => {
    const result = await searchAuthUserByEmail({}, fd({ email: 'find@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.matches).toHaveLength(1);
    expect(result.data?.matches[0].profileId).toBe(AUTH_USER_UUID);
  });

  it('returns RATE_LIMITED when rate limit exceeded', async () => {
    mockState.rateLimitSuccess = false;
    const result = await searchAuthUserByEmail({}, fd({ email: 'find@example.com' }));
    expect(result.error?.code).toBe('RATE_LIMITED');
  });
});
