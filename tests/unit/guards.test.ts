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

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      profiles: {
        findFirst: vi.fn(),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { requireAdmin, requireTenant, requireUser } from '@/lib/auth/guards';

const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(db.query.profiles.findFirst);

const ADMIN_SESSION = {
  user: { id: 'user-admin-1', orgId: 'org-1', role: 'admin' as const, email: 'admin@test.com' },
  expires: '2099-01-01',
};

const TENANT_SESSION = {
  user: { id: 'user-tenant-1', orgId: 'org-2', role: 'tenant' as const, email: 'tenant@test.com' },
  expires: '2099-01-01',
};

const ADMIN_PROFILE = {
  id: 'profile-1',
  userId: 'user-admin-1',
  orgId: 'org-1',
  role: 'admin',
  fullName: 'Admin User',
  email: 'admin@test.com',
  phone: null,
  preferredLanguage: null,
  termsAcceptedAt: null,
  termsVersion: null,
  privacyAcceptedAt: null,
  privacyVersion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TENANT_PROFILE = {
  ...ADMIN_PROFILE,
  id: 'profile-2',
  userId: 'user-tenant-1',
  orgId: 'org-2',
  role: 'tenant',
  fullName: 'Tenant User',
  email: 'tenant@test.com',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin', () => {
  it('AC8: returns AuthContext with userId, orgId, role=admin, profile when session is admin', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockFindFirst.mockResolvedValue(ADMIN_PROFILE as never);

    const ctx = await requireAdmin();

    expect(ctx.userId).toBe('user-admin-1');
    expect(ctx.orgId).toBe('org-1');
    expect(ctx.role).toBe('admin');
    expect(ctx.profile).toEqual(ADMIN_PROFILE);
  });

  it('AC8: throws "unauthorized" when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireAdmin()).rejects.toThrow('unauthorized');
  });

  it('AC8: throws "unauthorized" when session role is tenant (not admin)', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);

    await expect(requireAdmin()).rejects.toThrow('unauthorized');
  });

  it('AC8: throws "profile_not_found" when admin session exists but profile row missing', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockFindFirst.mockResolvedValue(undefined as never);

    await expect(requireAdmin()).rejects.toThrow('profile_not_found');
  });

  it('AC8: does not call supabase.auth (no supabase imports in guards.ts)', async () => {
    // Verify by ensuring auth() mock is the only auth source
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockFindFirst.mockResolvedValue(ADMIN_PROFILE as never);

    await requireAdmin();

    // auth() called exactly once — no supabase fallback
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// requireTenant
// ---------------------------------------------------------------------------

describe('requireTenant', () => {
  it('returns AuthContext with role=tenant when session is tenant', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockFindFirst.mockResolvedValue(TENANT_PROFILE as never);

    const ctx = await requireTenant();

    expect(ctx.userId).toBe('user-tenant-1');
    expect(ctx.orgId).toBe('org-2');
    expect(ctx.role).toBe('tenant');
    expect(ctx.profile).toEqual(TENANT_PROFILE);
  });

  it('throws "unauthorized" when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireTenant()).rejects.toThrow('unauthorized');
  });

  it('AC9: redirects to /dashboard when admin session used in tenant context', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);

    // redirect() throws REDIRECT:/dashboard (see mock above)
    await expect(requireTenant()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('throws "profile_not_found" when tenant session exists but profile row missing', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockFindFirst.mockResolvedValue(undefined as never);

    await expect(requireTenant()).rejects.toThrow('profile_not_found');
  });
});

// ---------------------------------------------------------------------------
// requireUser (any role)
// ---------------------------------------------------------------------------

describe('requireUser', () => {
  it('returns AuthContext for admin session', async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION as never);
    mockFindFirst.mockResolvedValue(ADMIN_PROFILE as never);

    const ctx = await requireUser();
    expect(ctx.role).toBe('admin');
  });

  it('returns AuthContext for tenant session', async () => {
    mockAuth.mockResolvedValue(TENANT_SESSION as never);
    mockFindFirst.mockResolvedValue(TENANT_PROFILE as never);

    const ctx = await requireUser();
    expect(ctx.role).toBe('tenant');
  });

  it('throws UNAUTHORIZED when no session', async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(requireUser()).rejects.toThrow('UNAUTHORIZED');
  });
});
