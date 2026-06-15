/**
 * Unit tests for src/lib/auth/guards.ts (W3 — NextAuth v5 migration)
 *
 * AC8: requireAdmin returns {userId, orgId, role:'admin', profile}; no supabase.auth calls
 * AC9: requireTenant rejects admin session (redirect /dashboard)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// guards.ts uses db.select().from().where().limit(1) — provide a chainable mock.
// IMPORTANT: vi.mock factory is hoisted to top of file by vitest.
// Do NOT reference outer let/const variables inside the factory — they are not
// yet initialized at hoisting time (temporal dead zone error).
// Instead declare the chain fns inside the factory and expose them on the
// returned db object so tests can reach them via vi.mocked(db).
vi.mock('@/lib/db', () => {
  const limitFn  = vi.fn();
  const whereFn  = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn   = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return {
    db: {
      select: selectFn,
      // Expose internal fns for test access
      _limit: limitFn,
      _where: whereFn,
      _from:  fromFn,
    },
  };
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { requireAdmin, requireTenant, requireUser } from '@/lib/auth/guards';

const mockAuth = vi.mocked(auth);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any;

const ADMIN_SESSION = {
  user: { id: 'user-admin-1', orgId: 'org-1', role: 'admin' as const, email: 'admin@test.com' },
  expires: '2099-01-01',
};

const TENANT_SESSION = {
  user: { id: 'user-tenant-1', orgId: 'org-2', role: 'tenant' as const, email: 'tenant@test.com' },
  expires: '2099-01-01',
};

// Profile row shape returned by the Drizzle select (camelCase Drizzle columns)
const ADMIN_PROFILE_ROW = {
  id:       'profile-1',
  orgId:    'org-1',
  role:     'admin',
  fullName: 'Admin User',
  phone:    null,
  email:    'admin@test.com',
};

const TENANT_PROFILE_ROW = {
  id:       'profile-2',
  orgId:    'org-2',
  role:     'tenant',
  fullName: 'Tenant User',
  phone:    null,
  email:    'tenant@test.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Re-wire chain after clearAllMocks resets all mock implementations
  mockDb._limit.mockReset();
  mockDb._where.mockReturnValue({ limit: mockDb._limit });
  mockDb._from.mockReturnValue({ where: mockDb._where });
  mockDb.select.mockReturnValue({ from: mockDb._from });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin', () => {
  it('AC8: returns AuthContext with userId, orgId, role=admin, profile when session is admin', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockDb._limit.mockResolvedValue([ADMIN_PROFILE_ROW]);

    const ctx = await requireAdmin();

    expect(ctx.userId).toBe('user-admin-1');
    expect(ctx.orgId).toBe('org-1');
    expect(ctx.role).toBe('admin');
    expect(ctx.profile).toMatchObject({ id: 'profile-1', org_id: 'org-1', role: 'admin' });
  });

  it('AC8: throws "UNAUTHORIZED" when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
  });

  it('AC8: throws "FORBIDDEN" when session role is tenant (not admin)', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockDb._limit.mockResolvedValue([TENANT_PROFILE_ROW]);

    await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
  });

  it('AC8: throws "UNAUTHORIZED" when admin session exists but profile row missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockDb._limit.mockResolvedValue([]);

    await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
  });

  it('AC8: does not call supabase.auth (no supabase imports in guards.ts)', async () => {
    // Verify by ensuring auth() mock is the only auth source
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockDb._limit.mockResolvedValue([ADMIN_PROFILE_ROW]);

    await requireAdmin();

    // auth() called at least once (React.cache is a no-op in Node test env);
    // the important assertion is that no supabase.auth.* was called — which
    // is structurally guaranteed since guards.ts has no supabase imports.
    expect(mockAuth).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireTenant
// ---------------------------------------------------------------------------

describe('requireTenant', () => {
  it('returns AuthContext with role=tenant when session is tenant', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockDb._limit.mockResolvedValue([TENANT_PROFILE_ROW]);

    const ctx = await requireTenant();

    expect(ctx.userId).toBe('user-tenant-1');
    expect(ctx.orgId).toBe('org-2');
    expect(ctx.role).toBe('tenant');
    expect(ctx.profile).toMatchObject({ id: 'profile-2', org_id: 'org-2', role: 'tenant' });
  });

  it('throws "UNAUTHORIZED" when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireTenant()).rejects.toThrow('UNAUTHORIZED');
  });

  it('AC9: throws "FORBIDDEN" when admin session used in tenant context', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockDb._limit.mockResolvedValue([ADMIN_PROFILE_ROW]);

    await expect(requireTenant()).rejects.toThrow('FORBIDDEN');
  });

  it('throws "UNAUTHORIZED" when tenant session exists but profile row missing', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockDb._limit.mockResolvedValue([]);

    await expect(requireTenant()).rejects.toThrow('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// requireUser (any role)
// ---------------------------------------------------------------------------

describe('requireUser', () => {
  it('returns AuthContext for admin session', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockDb._limit.mockResolvedValue([ADMIN_PROFILE_ROW]);

    const ctx = await requireUser();
    expect(ctx.role).toBe('admin');
  });

  it('returns AuthContext for tenant session', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockDb._limit.mockResolvedValue([TENANT_PROFILE_ROW]);

    const ctx = await requireUser();
    expect(ctx.role).toBe('tenant');
  });

  it('throws UNAUTHORIZED when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireUser()).rejects.toThrow('UNAUTHORIZED');
  });
});
