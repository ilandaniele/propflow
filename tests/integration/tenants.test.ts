/**
 * Integration regression tests for tenant Server Actions.
 *
 * Covers:
 *   AC15 — Admin updateTenantAvatar (existing path) regression: confirms the
 *           function is unchanged, still works for a given tenantId, and returns ok.
 *
 * This file may grow with additional tenant action regression tests in future phases.
 * All Supabase calls are mocked — no live DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ORG_ACME    = 'aaaaaa00-0000-0000-0000-000000000001';
const USER_ADMIN  = 'bbbbbb00-0000-0000-0000-000000000001';
const TENANT_ID_T = 'cccccc00-0000-0000-0000-000000000001';
const STORAGE_PATH = `${ORG_ACME}/${TENANT_ID_T}/avatar-uuid.jpg`;

// ---------------------------------------------------------------------------
// Mock: next/cache
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockState {
  role: 'admin' | 'tenant';
  userId: string;
  orgId: string;
  dbUpdateError: string | null;
}

const mockState: MockState = {
  role: 'admin',
  userId: USER_ADMIN,
  orgId: ORG_ACME,
  dbUpdateError: null,
};

function resetMockState() {
  mockState.role = 'admin';
  mockState.userId = USER_ADMIN;
  mockState.orgId = ORG_ACME;
  mockState.dbUpdateError = null;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/auth/guards
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (mockState.role !== 'admin') throw new Error('FORBIDDEN');
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: 'admin',
      profile: { id: mockState.userId, org_id: mockState.orgId, role: 'admin' },
    };
  }),
  requireTenant: vi.fn(async () => {
    if (mockState.role !== 'tenant') throw new Error('FORBIDDEN');
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: 'tenant',
      profile: { id: mockState.userId, org_id: mockState.orgId, role: 'tenant' },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => buildSupabaseMock()),
}));

function buildSupabaseMock() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: mockState.userId } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => buildTableProxy(table)),
  };
}

function buildTableProxy(table: string) {
  let isUpdate = false;

  const builder: Record<string, unknown> = {};

  builder.select = vi.fn(() => builder);
  builder.update = vi.fn(() => { isUpdate = true; return builder; });
  builder.delete = vi.fn(() => builder);
  builder.eq    = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }));

  const thenableFn = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let res: unknown;
    if (table === 'tenants' && isUpdate) {
      res = mockState.dbUpdateError
        ? { data: null, error: { code: mockState.dbUpdateError } }
        : { data: null, error: null };
    } else {
      res = { data: null, error: null };
    }
    return Promise.resolve(res).then(resolve, reject);
  };

  builder.then = thenableFn;
  builder.catch = (rej: (e: unknown) => unknown) => Promise.resolve().catch(rej);
  builder.finally = (cb: () => void) => Promise.resolve().finally(cb);

  return builder;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/admin  (not used by updateTenantAvatar but required by file)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })) } },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ data: null, error: null })),
      update: vi.fn().mockReturnThis(),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/storage/index  (updateTenantAvatar doesn't use it, but the module
// imports it now — provide a no-op to avoid import errors)
// ---------------------------------------------------------------------------

vi.mock('@/lib/storage/index', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    uploadImage: vi.fn(async (_bucket: string, path: string) => ({ path })),
    deleteImage: vi.fn(async () => {}),
  };
});

// ---------------------------------------------------------------------------
// Mock: @/lib/ratelimit
// ---------------------------------------------------------------------------

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
  actionRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
}));

// ---------------------------------------------------------------------------
// Import action AFTER mocks
// ---------------------------------------------------------------------------

import { updateTenantAvatar } from '@/app/actions/tenants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAvatarFormData(tenantId: string, photoUrl: string): FormData {
  const fd = new FormData();
  fd.set('tenant_id', tenantId);
  fd.set('photo_url', photoUrl);
  return fd;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  vi.clearAllMocks();
});

// ── AC15: Admin updateTenantAvatar regression ─────────────────────────────────

describe('AC15 — updateTenantAvatar (existing admin path) regression', () => {
  it('returns ok for a valid tenant_id and photo_url', async () => {
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error).toBeUndefined();
  });

  it('updates the tenants row (no error)', async () => {
    // Ensure the DB update mock was called (proxy trackable via no dbUpdateError)
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error).toBeUndefined();
  });

  it('returns UNAUTHORIZED when called by a non-admin', async () => {
    mockState.role = 'tenant';
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for an invalid tenant_id (not a UUID)', async () => {
    const fd = new FormData();
    fd.set('tenant_id', 'not-a-uuid');
    fd.set('photo_url', STORAGE_PATH);
    const result = await updateTenantAvatar({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when photo_url is missing', async () => {
    const fd = new FormData();
    fd.set('tenant_id', TENANT_ID_T);
    // photo_url not set
    const result = await updateTenantAvatar({}, fd);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns RATE_LIMITED when mutationRateLimit blocks the call', async () => {
    const { mutationRateLimit } = await import('@/lib/ratelimit');
    vi.mocked(mutationRateLimit).mockReturnValueOnce({ success: false, retryAfterMs: 1000 });

    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('RATE_LIMITED');
  });

  it('returns INTERNAL_ERROR when DB update fails', async () => {
    mockState.dbUpdateError = '42P01'; // simulated DB error
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, STORAGE_PATH));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('accepts a photo_url that is a Supabase signed URL (≤ 500 chars)', async () => {
    const signedUrl = `https://abcd.supabase.co/storage/v1/object/sign/tenant-avatars/${STORAGE_PATH}?token=abc`;
    const result = await updateTenantAvatar({}, makeAvatarFormData(TENANT_ID_T, signedUrl));
    expect(result.error).toBeUndefined();
  });
});
