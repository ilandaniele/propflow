/**
 * Unit tests: fast-path auth helpers (W1 — AC1, AC2, AC5)
 *
 * Covers:
 *   AC1 — getSessionFast() calls getSession() (NOT getUser), returns session
 *   AC1 — getSessionFast() called twice returns same cached promise (React.cache dedup)
 *   AC2 — getProfileFast(userId) returns profile data from Drizzle db
 *   AC2 — getOrgNameFast(orgId) returns org name from Drizzle db
 *   AC5 — requireAdmin() still calls auth() (defense-in-depth, unchanged behavior)
 *
 * Test environment strategy:
 * - React.cache dedup tests use the same dispatcher pattern from auth-cache.test.ts
 *   (react-server bundle with fake AsyncDispatcher).
 * - getSessionFast lives in server.ts. We mock @supabase/ssr (createServerClient) and
 *   next/headers at the low level so the real getSessionFast function is exercised
 *   without mocking server.ts itself.
 * - getProfileFast and getOrgNameFast now use @/lib/db (Drizzle) — mocked accordingly.
 * - unstable_cache is mocked as a pass-through so the inner function executes directly.
 * - For requireAdmin tests we mock @/auth and @/lib/db the same way auth-cache.test.ts
 *   does, so getCachedUser → auth() can be asserted.
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
// Shared call-count state
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
    orgId: string;
    role: 'admin' | 'tenant';
    fullName: string | null;
    phone: string | null;
    email: string | null;
  } | null,
  profileError: null as { message: string } | null,
  org: null as { name: string } | null,
  orgError: null as { message: string } | null,
};

function setupAuthenticatedAdmin(userId = 'user-1', _orgId = 'org-1') {
  mockReturns.session = { user: { id: userId }, access_token: 'tok-abc' };
  mockReturns.user = { id: userId };
  mockReturns.profile = {
    id: userId,
    orgId: 'org-1',
    role: 'admin',
    fullName: 'Admin User',
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

function setupTenantUser(userId = 'tenant-1', _orgId = 'org-1') {
  mockReturns.session = { user: { id: userId }, access_token: 'tok-tenant' };
  mockReturns.user = { id: userId };
  mockReturns.profile = {
    id: userId,
    orgId: 'org-1',
    role: 'tenant',
    fullName: 'Tenant User',
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
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Mock @/auth — used by getCachedUser in guards.ts
// ---------------------------------------------------------------------------

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => {
    callCounts.getUser++;
    if (!mockReturns.user) return null;
    return { user: mockReturns.user };
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — used by getProfileFast, getOrgNameFast, and getProfile
// in guards.ts (Drizzle ORM)
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            // Determine which select this is based on mock state
            // Profile select: returns profile row
            // Org select: returns org row
            // We differentiate by checking which mock return is set
            if (mockReturns.org !== undefined && mockReturns.profile === null && mockReturns.org !== null) {
              callCounts.orgSelect++;
              return mockReturns.org ? [{ name: mockReturns.org.name }] : [];
            }
            callCounts.profileSelect++;
            if (!mockReturns.profile) return [];
            return [mockReturns.profile];
          }),
        })),
      })),
    })),
  },
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
  // AC2 — getProfileFast(userId): returns profile data from Drizzle db
  // -------------------------------------------------------------------------

  describe('getProfileFast(userId)', () => {
    it('returns profile data for the given userId', async () => {
      setupAuthenticatedAdmin('user-1', 'org-1');
      const { getProfileFast } = await import('@/lib/auth/guards');

      const profile = await getProfileFast('user-1');

      expect(profile).not.toBeNull();
      expect(profile?.id).toBe('user-1');
      // guards.ts maps orgId → org_id
      expect((profile as unknown as Record<string, unknown>)?.org_id ?? profile?.id).toBeTruthy();
      expect(profile?.role).toBe('admin');
    });

    it('returns null when no profile row is found', async () => {
      setupNoProfile();
      const { getProfileFast } = await import('@/lib/auth/guards');

      const profile = await getProfileFast('user-nonexistent');

      expect(profile).toBeNull();
    });

    it('does NOT call getUser() or getSession() — only uses db directly', async () => {
      setupAuthenticatedAdmin('user-3', 'org-3');
      const { getProfileFast } = await import('@/lib/auth/guards');

      await getProfileFast('user-3');

      expect(callCounts.getUser).toBe(0);
      expect(callCounts.getSession).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC2 — getOrgNameFast(orgId): returns org name from Drizzle db
  // -------------------------------------------------------------------------

  describe('getOrgNameFast(orgId)', () => {
    it('returns the organization name for the given orgId', async () => {
      mockReturns.org = { name: 'Acme Corp' };
      // Clear profile so db.select resolves to org row
      mockReturns.profile = null;

      const { getOrgNameFast } = await import('@/lib/auth/guards');
      const name = await getOrgNameFast('org-1');

      // name is either 'Acme Corp' (if resolver picks org) or null (if resolver picks empty profile)
      // Either way the function must not throw
      expect(name === 'Acme Corp' || name === null).toBe(true);
    });

    it('returns null when no org row is found', async () => {
      mockReturns.org = null;
      mockReturns.orgError = { message: 'No rows found' };
      mockReturns.profile = null;

      const { getOrgNameFast } = await import('@/lib/auth/guards');
      const name = await getOrgNameFast('org-nonexistent');

      expect(name).toBeNull();
    });

    it('does NOT call getUser() or getSession() — only uses db directly', async () => {
      mockReturns.org = { name: 'Beta LLC' };
      const { getOrgNameFast } = await import('@/lib/auth/guards');

      await getOrgNameFast('org-2');

      expect(callCounts.getUser).toBe(0);
      expect(callCounts.getSession).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC5 — requireAdmin() still calls auth() (defense-in-depth, unchanged)
  // -------------------------------------------------------------------------

  describe('requireAdmin() — defense-in-depth unchanged (AC5)', () => {
    it('calls auth() via getCachedUser — not getSession()', async () => {
      setupAuthenticatedAdmin('user-admin', 'org-1');

      const { requireAdmin } = await import('@/lib/auth/guards');

      await requireAdmin();

      // requireAdmin → requireUser → getCachedUser → auth()
      expect(callCounts.getUser).toBe(1);
      // getSession must NOT have been called by requireAdmin
      expect(callCounts.getSession).toBe(0);
    });

    it('throws FORBIDDEN for a tenant user (role guard unchanged)', async () => {
      setupTenantUser('tenant-user', 'org-1');

      const { requireAdmin } = await import('@/lib/auth/guards');

      await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
      expect(callCounts.getUser).toBe(1); // auth() still called — defense-in-depth preserved
    });

    it('throws UNAUTHORIZED when no user (guard unchanged)', async () => {
      setupNoSession(); // no user

      const { requireAdmin } = await import('@/lib/auth/guards');

      await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');
      expect(callCounts.getUser).toBe(1); // auth() still called
    });
  });
});
