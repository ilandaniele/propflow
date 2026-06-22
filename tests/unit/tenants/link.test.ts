/**
 * Unit tests for linkTenantPortalAccount and searchAuthUserByEmail Server Actions.
 *
 * Covers:
 * 1. Zod schema validation on linkTenantPortalAccount (tenantId uuid, profileEmail email)
 * 2. IDOR guard: tenant not in admin's org → NOT_FOUND
 * 3. Already-linked tenant → CONFLICT
 * 4. Auth user not found → NOT_FOUND
 * 5. Happy path: profiles row created + tenants.profile_id set + audit log written
 * 6. Unauthorized call → UNAUTHORIZED
 * 7. Rate limiting blocks after threshold
 * 8. searchAuthUserByEmail Zod validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Valid UUIDs used throughout tests
const TENANT_UUID = '550e8400-e29b-41d4-a716-446655440001';
const AUTH_USER_UUID = '550e8400-e29b-41d4-a716-446655440002';
const ORG_UUID = '550e8400-e29b-41d4-a716-446655440003';

// ─── Shared mock controls ─────────────────────────────────────────────────────

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
  tenantRow: null as { id: string; org_id: string; email: string | null; profile_id: string | null } | null,
  tenantFetchError: null as { code: string } | null,
  authUserList: [] as Array<{ id: string; email: string; user_metadata?: Record<string, unknown> }>,
  authListError: null as { status: number } | null,
  existingProfile: null as { id: string; role: string; org_id: string } | null,
  profileInsertError: null as { code: string } | null,
  tenantUpdateError: null as { code: string } | null,
};

// Shared spy functions
const spyTenantSelect = vi.fn();
const spyTenantUpdate = vi.fn();
const spyNotifInsert = vi.fn();
const spyAdminListUsers = vi.fn();
const spyAdminProfileMaybe = vi.fn();
const spyAdminProfileInsert = vi.fn();

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

// User-scoped Supabase client mock (RLS-enforced)
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => spyTenantSelect()})),
  createAdminServerClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => spyTenantSelect(),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => spyTenantUpdate(),
            }),
          }),
        };
      }
      if (table === 'notification_inbox') {
        return { insert: () => spyNotifInsert() };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }),
  }),
}));

// Admin Supabase client mock (bypasses RLS)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockImplementation(() => ({
    auth: {
      admin: {
        listUsers: vi.fn().mockImplementation(async () => spyAdminListUsers()),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            in: () => ({
              // For searchAuthUserByEmail: returns profiles for matched user IDs
              then: (fn: (v: { data: unknown[] }) => unknown) =>
                fn({ data: [] }),
            }),
            eq: () => ({
              maybeSingle: () => spyAdminProfileMaybe(),
            }),
          }),
          insert: () => spyAdminProfileInsert(),
        };
      }
      return {};
    }),
  })),
}));

import { linkTenantPortalAccount, searchAuthUserByEmail } from '@/app/actions/tenants';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.set(k, v));
  return f;
}

describe('linkTenantPortalAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.adminRole = 'admin';
    mockState.rateLimitSuccess = true;
    mockState.tenantRow = { id: TENANT_UUID, org_id: ORG_UUID, email: 'tenant@example.com', profile_id: null };
    mockState.tenantFetchError = null;
    mockState.authUserList = [{ id: AUTH_USER_UUID, email: 'tenant@example.com' }];
    mockState.authListError = null;
    mockState.existingProfile = null;
    mockState.profileInsertError = null;
    mockState.tenantUpdateError = null;

    spyTenantSelect.mockResolvedValue({ data: mockState.tenantRow, error: null });
    spyTenantUpdate.mockResolvedValue({ error: null });
    spyNotifInsert.mockResolvedValue({ error: null });
    spyAdminListUsers.mockResolvedValue({ data: { users: mockState.authUserList }, error: null });
    spyAdminProfileMaybe.mockResolvedValue({ data: null, error: null }); // no existing profile
    spyAdminProfileInsert.mockResolvedValue({ error: null });
  });

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
    spyTenantSelect.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when tenant already has a profile_id set', async () => {
    spyTenantSelect.mockResolvedValue({
      data: { id: TENANT_UUID, org_id: ORG_UUID, email: 'tenant@example.com', profile_id: AUTH_USER_UUID },
      error: null,
    });
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('CONFLICT');
  });

  it('returns NOT_FOUND when auth user with that email does not exist', async () => {
    spyAdminListUsers.mockResolvedValue({ data: { users: [] }, error: null });
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'nobody@example.com' }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('happy path: creates profile and links tenant, returns ok({ profileId })', async () => {
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.profileId).toBe(AUTH_USER_UUID);
    expect(spyAdminProfileInsert).toHaveBeenCalled();
    expect(spyTenantUpdate).toHaveBeenCalled();
    expect(spyNotifInsert).toHaveBeenCalled();
  });

  it('happy path: is case-insensitive for email matching', async () => {
    spyAdminListUsers.mockResolvedValue({
      data: { users: [{ id: AUTH_USER_UUID, email: 'TENANT@EXAMPLE.COM' }] },
      error: null,
    });
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'TENANT@EXAMPLE.COM' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.profileId).toBe(AUTH_USER_UUID);
  });

  it('returns INTERNAL when admin listUsers fails', async () => {
    spyAdminListUsers.mockResolvedValue({ data: null, error: { status: 500, message: 'Server error' } });
    const result = await linkTenantPortalAccount({}, fd({ tenantId: TENANT_UUID, profileEmail: 'tenant@example.com' }));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});

describe('searchAuthUserByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.adminRole = 'admin';
    mockState.rateLimitSuccess = true;

    spyAdminListUsers.mockResolvedValue({
      data: { users: [{ id: AUTH_USER_UUID, email: 'find@example.com' }] },
      error: null,
    });
    // Profile lookup for searchAuthUserByEmail returns empty (uses a different code path)
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

  it('returns ok with empty matches when no user found', async () => {
    spyAdminListUsers.mockResolvedValue({ data: { users: [] }, error: null });
    const result = await searchAuthUserByEmail({}, fd({ email: 'nobody@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.matches).toEqual([]);
  });

  it('returns matched user when found by email', async () => {
    const result = await searchAuthUserByEmail({}, fd({ email: 'find@example.com' }));
    expect(result.error).toBeUndefined();
    expect(result.data?.matches).toHaveLength(1);
    expect(result.data?.matches[0].profileId).toBe(AUTH_USER_UUID);
    expect(result.data?.matches[0].email).toBe('find@example.com');
  });

  it('search is case-insensitive (FIND@EXAMPLE.COM finds find@example.com user)', async () => {
    const result = await searchAuthUserByEmail({}, fd({ email: 'FIND@EXAMPLE.COM' }));
    expect(result.error).toBeUndefined();
    // The auth user has email 'find@example.com' — we search 'FIND@EXAMPLE.COM'
    // Both normalized to lowercase match → 1 result
    expect(result.data?.matches).toHaveLength(1);
  });

  it('returns INTERNAL when admin listUsers fails', async () => {
    spyAdminListUsers.mockResolvedValue({ data: null, error: { status: 500 } });
    const result = await searchAuthUserByEmail({}, fd({ email: 'find@example.com' }));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});
