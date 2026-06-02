/**
 * Unit tests: React.cache deduplication for auth helpers
 *
 * Verifies that wrapping getCachedUser, getProfile, and requireUser in
 * React.cache() causes the underlying Supabase round-trips (getUser network
 * call + profiles SELECT) to fire at most once per React render pass,
 * regardless of how many callers invoke the helpers concurrently.
 *
 * Test environment strategy:
 * Vitest runs in Node.js without a React server renderer. The standard
 * `react` package ships a no-op cache() in that context. To enable proper
 * deduplication we mock the `react` module to return the react-server bundle
 * (which ships a real memo-by-dispatcher implementation) and install a
 * minimal fake AsyncDispatcher before each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Dispatcher setup for React.cache to work in Node test environment
// ---------------------------------------------------------------------------

/**
 * Returns the Next.js-compiled react-server bundle.
 * This bundle exports the real React.cache() that uses ReactSharedInternals.A
 * for per-render memoisation. The standard `react` bundle ships a no-op cache().
 */
function getReactServerBundle() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('next/dist/compiled/react/cjs/react.react-server.development.js') as {
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => T;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      A: null | { getCacheForType: (createFn: () => unknown) => Map<unknown, unknown> };
    };
  };
}

/**
 * Creates a fresh per-test fake AsyncDispatcher that mirrors what the
 * Next.js React server renderer provides for each incoming request.
 * Each test gets a new WeakMap so the cache state is isolated.
 */
function createFakeRenderDispatcher() {
  const cacheStore = new WeakMap<() => unknown, Map<unknown, unknown>>();
  return {
    getCacheForType(createFn: () => unknown) {
      let entry = cacheStore.get(createFn);
      if (!entry) {
        // createFn is a React-internal factory that returns a Map root.
        entry = createFn() as Map<unknown, unknown>;
        cacheStore.set(createFn, entry);
      }
      return entry;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock react to use the real react-server implementation
// vi.mock is hoisted — return a factory that resolves lazily so the require()
// above runs after module resolution is set up.
// ---------------------------------------------------------------------------

vi.mock('react', async () => {
  // Delegate to the Next.js-compiled react-server bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const serverBundle = require('next/dist/compiled/react/cjs/react.react-server.development.js');
  return serverBundle;
});

// ---------------------------------------------------------------------------
// Shared mock state — mutated by helpers, read by mocks and assertions
// ---------------------------------------------------------------------------

interface MockState {
  getUserCallCount: number;
  profileSelectCallCount: number;
  getUserResult: { data: { user: { id: string } | null }; error: null };
  profileResult: {
    data: { id: string; org_id: string; role: 'admin' | 'tenant'; full_name: string | null; phone: string | null; email: string | null } | null;
    error: null;
  };
}

const s: MockState = {
  getUserCallCount: 0,
  profileSelectCallCount: 0,
  getUserResult: { data: { user: null }, error: null },
  profileResult: { data: null, error: null },
};

function setupAuthenticatedAdmin(userId = 'user-uuid-1') {
  s.getUserCallCount = 0;
  s.profileSelectCallCount = 0;
  s.getUserResult = { data: { user: { id: userId } }, error: null };
  s.profileResult = {
    data: { id: userId, org_id: 'org-uuid-1', role: 'admin', full_name: 'Admin User', phone: null, email: 'admin@test.com' },
    error: null,
  };
}

function setupAuthenticatedTenant(userId = 'user-uuid-2') {
  s.getUserCallCount = 0;
  s.profileSelectCallCount = 0;
  s.getUserResult = { data: { user: { id: userId } }, error: null };
  s.profileResult = {
    data: { id: userId, org_id: 'org-uuid-1', role: 'tenant', full_name: 'Tenant User', phone: null, email: 'tenant@test.com' },
    error: null,
  };
}

function setupUnauthenticated() {
  s.getUserCallCount = 0;
  s.profileSelectCallCount = 0;
  s.getUserResult = { data: { user: null }, error: null };
  s.profileResult = { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Supabase client mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => {
        s.getUserCallCount++;
        return s.getUserResult;
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => {
            s.profileSelectCallCount++;
            return s.profileResult;
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
// Tests
// ---------------------------------------------------------------------------

describe('React.cache deduplication — auth helpers', () => {
  const reactServer = getReactServerBundle();
  const internals = reactServer.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  beforeEach(() => {
    // Install a fresh render-pass dispatcher before each test.
    // This resets the cache so each test starts from a clean slate.
    internals.A = createFakeRenderDispatcher();
    setupAuthenticatedAdmin();
  });

  afterEach(() => {
    // Remove the dispatcher after each test to avoid cross-test leakage.
    internals.A = null;
  });

  // -------------------------------------------------------------------------
  // AC1 — getCachedUser: getUser fires exactly once per render pass
  // -------------------------------------------------------------------------

  it('getCachedUser — two concurrent calls fire getUser exactly once', async () => {
    const { getCachedUser } = await import('@/lib/auth/guards');

    // Simulate two concurrent callers (layout + page) within the same render pass.
    const p1 = getCachedUser();
    const p2 = getCachedUser();

    expect(p1).toBe(p2); // React.cache returns the same promise instance
    const [u1, u2] = await Promise.all([p1, p2]);

    expect(s.getUserCallCount).toBe(1);
    expect(u1).not.toBeNull();
    expect(u1).toStrictEqual(u2);
  });

  // -------------------------------------------------------------------------
  // AC1 — getProfile: profiles SELECT fires exactly once per render pass
  // -------------------------------------------------------------------------

  it('getProfile — two concurrent calls fire profiles SELECT exactly once', async () => {
    const { getProfile } = await import('@/lib/auth/guards');

    const p1 = getProfile();
    const p2 = getProfile();

    expect(p1).toBe(p2);
    const [prof1, prof2] = await Promise.all([p1, p2]);

    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(1);
    expect(prof1).not.toBeNull();
    expect(prof1).toStrictEqual(prof2);
  });

  // -------------------------------------------------------------------------
  // AC1 — requireUser: combined getUser + SELECT deduped
  // -------------------------------------------------------------------------

  it('requireUser — two concurrent calls issue one getUser + one SELECT', async () => {
    const { requireUser } = await import('@/lib/auth/guards');

    const p1 = requireUser();
    const p2 = requireUser();

    expect(p1).toBe(p2);
    const [ctx1, ctx2] = await Promise.all([p1, p2]);

    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(1);
    expect(ctx1.userId).toBe('user-uuid-1');
    expect(ctx1).toStrictEqual(ctx2);
  });

  // -------------------------------------------------------------------------
  // AC2 — Layout getProfile + page requireAdmin share cache
  // Simulates: DashboardLayout calls getProfile(), page calls requireAdmin()
  // Both run concurrently in the same React render pass.
  // -------------------------------------------------------------------------

  it('layout getProfile + page requireAdmin share cached auth — total round-trips = 2', async () => {
    const { getProfile, requireAdmin } = await import('@/lib/auth/guards');

    // Both start at the same time within the same render pass.
    const [profileFromLayout, ctxFromPage] = await Promise.all([
      getProfile(),
      requireAdmin(),
    ]);

    // Only 1 getUser network hop + 1 profiles SELECT for the entire render.
    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(1);

    expect(profileFromLayout).not.toBeNull();
    expect(ctxFromPage.role).toBe('admin');
    expect(ctxFromPage.userId).toBe('user-uuid-1');
  });

  // -------------------------------------------------------------------------
  // AC2 — Total auth round-trips: from 5 to ≤ 2
  // Old: layout (getUser + SELECT + org) + requireAdmin (getUser + SELECT) = 5 auth hops
  // New: getUser once + SELECT once + org SELECT = 2 auth hops
  // -------------------------------------------------------------------------

  it('sequential getProfile then requireAdmin — total auth hops ≤ 2 (was 5)', async () => {
    const { getProfile, requireAdmin } = await import('@/lib/auth/guards');

    await getProfile();     // layout auth check
    await requireAdmin();   // page guard — should reuse cache

    const totalAuthHops = s.getUserCallCount + s.profileSelectCallCount;
    expect(totalAuthHops).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // AC1 — Unauthenticated path: no profile SELECT fires when user is null
  // -------------------------------------------------------------------------

  it('unauthenticated getProfile — short-circuits after null user, no SELECT fired', async () => {
    setupUnauthenticated();
    const { getProfile } = await import('@/lib/auth/guards');

    const profile = await getProfile();

    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(0);
    expect(profile).toBeNull();
  });

  it('unauthenticated requireUser — throws UNAUTHORIZED, no profile SELECT fired', async () => {
    setupUnauthenticated();
    const { requireUser } = await import('@/lib/auth/guards');

    await expect(requireUser()).rejects.toThrow('UNAUTHORIZED');

    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(0);
  });

  it('unauthenticated requireAdmin — throws UNAUTHORIZED, no profile SELECT fired', async () => {
    setupUnauthenticated();
    const { requireAdmin } = await import('@/lib/auth/guards');

    await expect(requireAdmin()).rejects.toThrow('UNAUTHORIZED');

    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // AC1 — requireTenant: same cache dedup as requireAdmin
  // -------------------------------------------------------------------------

  it('requireTenant — two concurrent calls issue one getUser + one SELECT', async () => {
    setupAuthenticatedTenant();
    const { requireTenant } = await import('@/lib/auth/guards');

    // requireTenant is NOT wrapped in cache() itself — it calls the cached
    // requireUser() which is. The two calls return distinct promise objects but
    // both resolve to the same data using the same cached underlying round-trips.
    const [ctx1, ctx2] = await Promise.all([requireTenant(), requireTenant()]);

    // The key assertion: only 1 getUser + 1 SELECT despite two requireTenant calls.
    expect(s.getUserCallCount).toBe(1);
    expect(s.profileSelectCallCount).toBe(1);
    expect(ctx1.role).toBe('tenant');
    expect(ctx1).toStrictEqual(ctx2);
  });

  // -------------------------------------------------------------------------
  // Security: role enforcement is preserved despite cache wrapping
  // -------------------------------------------------------------------------

  it('requireAdmin — tenant user throws FORBIDDEN (role guard unchanged)', async () => {
    setupAuthenticatedTenant();
    const { requireAdmin } = await import('@/lib/auth/guards');

    await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
  });

  it('requireTenant — admin user throws FORBIDDEN (role guard unchanged)', async () => {
    setupAuthenticatedAdmin();
    const { requireTenant } = await import('@/lib/auth/guards');

    await expect(requireTenant()).rejects.toThrow('FORBIDDEN');
  });
});
