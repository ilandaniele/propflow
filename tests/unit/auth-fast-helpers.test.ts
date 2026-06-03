/**
 * Unit tests: fast-path auth helpers (W1 — AC1, AC2, AC5)
 *
 * Covers:
 *   AC1 — getSessionFast() calls getSession() (NOT getUser), returns session
 *   AC1 — getSessionFast() called twice returns same cached promise (React.cache dedup)
 *   AC2 — getProfileFast(userId) returns profile data from a mocked Supabase call
 *   AC2 — getOrgNameFast(orgId) returns org name from a mocked Supabase call
 *   AC5 — requireAdmin() still calls getUser() (defense-in-depth, unchanged behavior)
 *
 * Test environment strategy:
 * - React.cache dedup tests use the same dispatcher pattern from auth-cache.test.ts
 *   (react-server bundle with fake AsyncDispatcher).
 * - getSessionFast lives in server.ts. We mock @supabase/ssr (createServerClient) and
 *   next/headers at the low level so the real getSessionFast function is exercised
 *   without mocking server.ts itself.
 * - getProfileFast and getOrgNameFast use @/lib/supabase/admin — mocked separately.
 * - unstable_cache is mocked as a pass-through so the inner function executes directly
 *   (the Next.js cache store is not available in Vitest Node environment).
 * - For requireAdmin tests we mock @/lib/supabase/server (just createClient) the same
 *   way auth-cache.test.ts does, so getCachedUser → getUser() can be asserted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Dispatcher setup — same pattern as auth-cache.test.ts
// ---------------------------------------------------------------------------

function getReactServerBundle() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('next/dist/compiled/react/cjs/react.react-server.development.js') as {
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => T;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      A: null | { getCacheForType: (createFn: () => unknown) => Map<unknown, unknown> };
    };
  };
}

function createFakeRenderDispatcher() {
  const cacheStore = new WeakMap<() => unknown, Map<unknown, unknown>>();
  return {
    getCacheForType(createFn: () => unknown) {
      let entry = cacheStore.get(createFn);
      if (!entry) {
        entry = createFn() as Map<unknown, unknown>;
        cacheStore.set(createFn, entry);
      }
      return entry;
    },
  };
}

vi.mock('react', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const serverBundle = require('next/dist/compiled/react/cjs/react.react-server.development.js');
  return serverBundle;
});

// ---------------------------------------------------------------------------
// Mock unstable_cache as a transparent pass-through.
// We call the inner function directly so we can assert on what Supabase calls
// it makes. Cache deduplication across requests is a Next.js runtime concern
// that cannot be exercised in a Vitest Node environment.
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  unstable_cache: vi.fn(
    (fn: (...args: unknown[]) => Promise<unknown>, _keyParts: string[], _opts: unknown) =>
      (...args: unknown[]) => fn(...args)
  ),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared call-count state — mutated by mocked Supabase client methods
// ---------------------------------------------------------------------------

const callCounts = {
  getSession: 0,
  getUser: 0,
  profileSelect: 0,
  orgSelect: 0,
};

function resetCounts() {
  callCounts.getSession = 0;
  callCounts.getUser = 0;
  callCounts.profileSelect = 0;
  callCounts.orgSelect = 0;
}

// ---------------------------------------------------------------------------
// Controlled return values
// ---------------------------------------------------------------------------

const mockReturns = {
  session: null as { user: { id: string }; access_token: string } | null,
  user: null as { id: string } | null,
  profile: null as {
    id: string;
    org_id: string;
    role: 'admin' | 'tenant';
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null,
  profileError: null as { message: string } | null,
  org: null as { name: string } | null,
  orgError: null as { message: string } | null,
};

function setupAuthenticatedAdmin(userId = 'user-1', orgId = 'org-1') {
  mockReturns.session = { user: { id: userId }, access_token: 'tok-abc' };
  mockReturns.user = { id: userId };
  mockReturns.profile = {
    id: userId,
    org_id: orgId,
    role: 'admin',
    full_name: 'Admin User',
    phone: null,
    email: 'admin@test.com',
  };
  mockReturns.profileError = null;
}

function setupNoSession() {
  mockReturns.session = null;
  mockReturns.user = null;
}

function setupNoProfile() {
  mockReturns.profile = null;
  mockReturns.profileError = { message: 'No rows found' };
}

function setupTenantUser(userId = 'tenant-1', orgId = 'org-1') {
  mockReturns.session = { user: { id: userId }, access_token: 'tok-tenant' };
  mockReturns.user = { id: userId };
  mockReturns.profile = {
    id: userId,
    org_id: orgId,
    role: 'tenant',
    full_name: 'Tenant User',
    phone: null,
    email: 'tenant@test.com',
  };
  mockReturns.profileError = null;
}

// ---------------------------------------------------------------------------
// Mock @supabase/ssr at the lowest level so server.ts (getSessionFast,
// createClient) can be imported as-is and exercised with a fake Supabase client.
// ---------------------------------------------------------------------------

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => {
        callCounts.getSession++;
        return { data: { session: mockReturns.session }, error: null };
      }),
      getUser: vi.fn(async () => {
        callCounts.getUser++;
        return {
          data: { user: mockReturns.user },
          error: mockReturns.user ? null : { message: 'Not authenticated' },
        };
      }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => {
            if (table === 'profiles') {
              callCounts.profileSelect++;
              return { data: mockReturns.profile, error: mockReturns.profileError };
            }
            return { data: null, error: { message: 'unknown table' } };
          }),
        })),
      })),
    })),
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/admin — used by getProfileFast and getOrgNameFast
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => {
            if (table === 'profiles') {
              callCounts.profileSelect++;
              return { data: mockReturns.profile, error: mockReturns.profileError };
            }
            if (table === 'organizations') {
              callCounts.orgSelect++;
              return { data: mockReturns.org, error: mockReturns.orgError };
            }
            return { data: null, error: { message: 'unknown table' } };
          }),
        })),
      })),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fast-path auth helpers', () => {
  const reactServer = getReactServerBundle();
  const internals = reactServer.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  beforeEach(() => {
    internals.A = createFakeRenderDispatcher();
    resetCounts();
    // Reset to unauthenticated by default; each test sets its own state
    mockReturns.session = null;
    mockReturns.user = null;
    mockReturns.profile = null;
    mockReturns.profileError = null;
    mockReturns.org = null;
    mockReturns.orgError = null;
  });

  afterEach(() => {
    internals.A = null;
  });

  // -------------------------------------------------------------------------
  // AC1 — getSessionFast(): calls getSession() (NOT getUser), returns session
  // -------------------------------------------------------------------------

  describe('getSessionFast()', () => {
    it('calls getSession() (not getUser()) and returns the session object', async () => {
      setupAuthenticatedAdmin('user-1');
      const { getSessionFast } = await import('@/lib/supabase/server');

      const session = await getSessionFast();

      expect(callCounts.getSession).toBe(1);
      expect(callCounts.getUser).toBe(0); // must NOT call getUser
      expect(session).not.toBeNull();
      expect(session?.user.id).toBe('user-1');
    });

    it('returns null when no session cookie is present', async () => {
      setupNoSession();
      const { getSessionFast } = await import('@/lib/supabase/server');

      const session = await getSessionFast();

      expect(callCounts.getUser).toBe(0); // must NOT call getUser
      expect(session).toBeNull();
    });

    it('called twice in the same render pass returns the same promise (React.cache dedup)', async () => {
      setupAuthenticatedAdmin('user-2');
      const { getSessionFast } = await import('@/lib/supabase/server');

      // Both calls within the same render pass should return the same Promise
      const p1 = getSessionFast();
      const p2 = getSessionFast();

      expect(p1).toBe(p2); // exact same Promise instance — no duplicate work
      const [s1, s2] = await Promise.all([p1, p2]);

      // getSession() must have been called exactly once despite two callers
      expect(callCounts.getSession).toBe(1);
      expect(s1).toStrictEqual(s2);
      expect(s1?.user.id).toBe('user-2');
    });
  });

  // -------------------------------------------------------------------------
  // AC2 — getProfileFast(userId): returns profile data from Supabase
  // -------------------------------------------------------------------------

  describe('getProfileFast(userId)', () => {
    it('returns profile data for the given userId', async () => {
      setupAuthenticatedAdmin('user-1', 'org-1');
      const { getProfileFast } = await import('@/lib/auth/guards');

      const profile = await getProfileFast('user-1');

      expect(profile).not.toBeNull();
      expect(profile?.id).toBe('user-1');
      expect(profile?.org_id).toBe('org-1');
      expect(profile?.role).toBe('admin');
      expect(profile?.full_name).toBe('Admin User');
      expect(profile?.email).toBe('admin@test.com');
      expect(callCounts.profileSelect).toBe(1);
    });

    it('returns null when no profile row is found', async () => {
      setupNoProfile();
      const { getProfileFast } = await import('@/lib/auth/guards');

      const profile = await getProfileFast('user-nonexistent');

      expect(profile).toBeNull();
      expect(callCounts.profileSelect).toBe(1);
    });

    it('does NOT call getUser() or getSession() — only uses admin client', async () => {
      setupAuthenticatedAdmin('user-3', 'org-3');
      const { getProfileFast } = await import('@/lib/auth/guards');

      await getProfileFast('user-3');

      expect(callCounts.getUser).toBe(0);
      expect(callCounts.getSession).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC2 — getOrgNameFast(orgId): returns org name from Supabase
  // -------------------------------------------------------------------------

  describe('getOrgNameFast(orgId)', () => {
    it('returns the organization name for the given orgId', async () => {
      mockReturns.org = { name: 'Acme Corp' };
      const { getOrgNameFast } = await import('@/lib/auth/guards');

      const name = await getOrgNameFast('org-1');

      expect(name).toBe('Acme Corp');
      expect(callCounts.orgSelect).toBe(1);
    });

    it('returns null when no org row is found', async () => {
      mockReturns.org = null;
      mockReturns.orgError = { message: 'No rows found' };
      const { getOrgNameFast } = await import('@/lib/auth/guards');

      const name = await getOrgNameFast('org-nonexistent');

      expect(name).toBeNull();
      expect(callCounts.orgSelect).toBe(1);
    });

    it('does NOT call getUser() or getSession() — only uses admin client', async () => {
      mockReturns.org = { name: 'Beta LLC' };
      const { getOrgNameFast } = await import('@/lib/auth/guards');

      await getOrgNameFast('org-2');

      expect(callCounts.getUser).toBe(0);
      expect(callCounts.getSession).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC5 — requireAdmin() still calls getUser() (defense-in-depth, unchanged)
  // -------------------------------------------------------------------------

  describe('requireAdmin() — defense-in-depth unchanged (AC5)', () => {
    it('calls getUser() via getCachedUser — not getSession()', async () => {
      setupAuthenticatedAdmin('user-admin', 'org-1');

      const { requireAdmin } = await import('@/lib/auth/guards');

      await requireAdmin();

      // requireAdmin → requireUser → getCachedUser → getUser()
      expect(callCounts.getUser).toBe(1);
      // getSession must NOT have been called by requireAdmin
      expect(callCounts.getSession).toBe(0);
    });

    it('throws FORBIDDEN for a tenant user (role guard unchanged)', async () => {
      setupTenantUser('tenant-user', 'org-1');

      const { requireAdmin } = await import('@/lib/auth/guards');

      await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
      expect(callCounts.getUser).toBe(1); // getUser still called — defense-in-depth preserved
    });

    it('throws UNAUTHORIZED when no user (guard unchanged)', async () => {
      setupNoSession(); // no user

      const { requireAdmin } = await import('@/lib/auth/guards');

      await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
      expect(callCounts.getUser).toBe(1); // getUser still called
    });
  });
});
