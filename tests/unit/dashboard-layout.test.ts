/**
 * Unit tests: dashboard layout fast-auth path (W2 — AC3)
 *
 * Covers:
 *   AC3 — layout calls getSessionFast() (NOT getCachedUser, NOT getUser)
 *   AC3 — layout redirects to /login when session is null
 *   AC3 — layout redirects to /login when profile is null
 *   AC3 — layout redirects to /login when role is 'tenant'
 *   AC3 — layout renders with orgName when session + admin profile + org are valid
 *
 * Test strategy:
 * - Mock getSessionFast from @/lib/supabase/server and getProfileFast,
 *   getOrgNameFast from @/lib/auth/guards so we can control their return values.
 * - Mock next/navigation redirect as a throwing sentinel so we can assert
 *   redirect('/login') was called without React rendering machinery.
 * - Mock the shell components (AdminSidebar, AdminTopbar) as lightweight stubs
 *   so the test is not coupled to their internal implementation.
 * - Call DashboardLayout as a plain async function — the test exercises the
 *   control-flow logic without a DOM or React renderer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Sentinel for redirect assertions
// ---------------------------------------------------------------------------

class RedirectError extends Error {
  constructor(public readonly destination: string) {
    super(`REDIRECT:${destination}`);
    this.name = 'RedirectError';
  }
}

// ---------------------------------------------------------------------------
// Mock next/navigation — redirect must throw so the layout short-circuits
// exactly as it does at runtime (Next.js redirect() throws internally).
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock unstable_cache as a transparent pass-through (same as auth-fast-helpers)
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
// Controlled return values for fast-path helpers
// ---------------------------------------------------------------------------

const mockState = {
  session: null as { user: { id: string }; access_token: string } | null,
  profile: null as {
    id: string;
    org_id: string;
    role: 'admin' | 'tenant';
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null,
  orgName: null as string | null,
};

// ---------------------------------------------------------------------------
// Mock fast-path helpers
// These are the ONLY auth helpers the layout should call after the refactor.
// ---------------------------------------------------------------------------

const mockGetSessionFast = vi.fn(async () => mockState.session);
const mockGetProfileFast = vi.fn(async (_userId: string) => mockState.profile);
const mockGetOrgNameFast = vi.fn(async (_orgId: string) => mockState.orgName);

vi.mock('@/lib/supabase/server', () => ({
  getSessionFast: () => mockGetSessionFast(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/auth/guards', () => ({
  getProfileFast: (userId: string) => mockGetProfileFast(userId),
  getOrgNameFast: (orgId: string) => mockGetOrgNameFast(orgId),
  // Keep other exports present so no import errors in transitively loaded modules
  getCachedUser: vi.fn(),
  getProfile: vi.fn(),
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  requireTenant: vi.fn(),
  getOrgScopedClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stub shell components so the layout can render (or at least reach JSX)
// without importing their full implementation.
// ---------------------------------------------------------------------------

vi.mock('@/components/shell/AdminSidebar', () => ({
  AdminSidebar: vi.fn(() => null),
}));

vi.mock('@/components/shell/AdminTopbar', () => ({
  AdminTopbar: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAdminSession(userId = 'user-1', orgId = 'org-1') {
  mockState.session = { user: { id: userId }, access_token: 'tok-admin' };
  mockState.profile = {
    id: userId,
    org_id: orgId,
    role: 'admin',
    full_name: 'Admin User',
    phone: null,
    email: 'admin@test.com',
  };
  mockState.orgName = 'Acme Corp';
}

function setupTenantSession(userId = 'tenant-1', orgId = 'org-1') {
  mockState.session = { user: { id: userId }, access_token: 'tok-tenant' };
  mockState.profile = {
    id: userId,
    org_id: orgId,
    role: 'tenant',
    full_name: 'Tenant User',
    phone: null,
    email: 'tenant@test.com',
  };
  mockState.orgName = null;
}

function resetState() {
  mockState.session = null;
  mockState.profile = null;
  mockState.orgName = null;
  mockGetSessionFast.mockClear();
  mockGetProfileFast.mockClear();
  mockGetOrgNameFast.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardLayout — fast-auth path (AC3)', () => {
  beforeEach(resetState);

  // -------------------------------------------------------------------------
  // AC3: layout calls getSessionFast() (NOT getUser / getCachedUser)
  // -------------------------------------------------------------------------

  it('calls getSessionFast() to obtain the session', async () => {
    setupAdminSession();
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    // Run the layout — it is an async Server Component function.
    // We pass a minimal children prop; actual rendering is not tested here.
    await DashboardLayout({ children: null });

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
  });

  it('does NOT call getCachedUser or getUser directly', async () => {
    setupAdminSession();
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');
    const { getCachedUser } = await import('@/lib/auth/guards');

    await DashboardLayout({ children: null });

    // getCachedUser is mocked — assert it was never called by the layout
    expect(getCachedUser).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3: layout calls getProfileFast(session.user.id) after obtaining session
  // -------------------------------------------------------------------------

  it('calls getProfileFast() with the session user id', async () => {
    setupAdminSession('user-abc', 'org-xyz');
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    await DashboardLayout({ children: null });

    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledWith('user-abc');
  });

  // -------------------------------------------------------------------------
  // AC3: layout calls getOrgNameFast(profile.org_id)
  // -------------------------------------------------------------------------

  it('calls getOrgNameFast() with the profile org_id', async () => {
    setupAdminSession('user-1', 'org-999');
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    await DashboardLayout({ children: null });

    expect(mockGetOrgNameFast).toHaveBeenCalledTimes(1);
    expect(mockGetOrgNameFast).toHaveBeenCalledWith('org-999');
  });

  // -------------------------------------------------------------------------
  // AC3: redirect to /login when session is null
  // -------------------------------------------------------------------------

  it('redirects to /login when session is null', async () => {
    // session remains null (resetState)
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      new RedirectError('/login')
    );

    // getProfileFast must NOT be called — short-circuit after null session
    expect(mockGetProfileFast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3: redirect to /login when profile is null (no profile row for user)
  // -------------------------------------------------------------------------

  it('redirects to /login when profile is null', async () => {
    mockState.session = { user: { id: 'user-orphan' }, access_token: 'tok' };
    mockState.profile = null;
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      new RedirectError('/login')
    );

    // getSessionFast was called, getProfileFast was called, redirect fired
    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    // getOrgNameFast must NOT be called — short-circuit after null profile
    expect(mockGetOrgNameFast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3: redirect to /login when role is 'tenant'
  // -------------------------------------------------------------------------

  it("redirects to /login when profile role is 'tenant'", async () => {
    setupTenantSession('tenant-2', 'org-1');
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      new RedirectError('/login')
    );

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    // role guard fires before org lookup — getOrgNameFast not called
    expect(mockGetOrgNameFast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3: renders (no redirect) when session + admin profile + org are valid
  // -------------------------------------------------------------------------

  it('renders without redirecting when session, admin profile, and org are valid', async () => {
    setupAdminSession('user-ok', 'org-ok');
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');

    // Should resolve without throwing a RedirectError
    await expect(DashboardLayout({ children: null })).resolves.not.toThrow();

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    expect(mockGetOrgNameFast).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // AC3: no network round-trip to Supabase Auth (getUser never called)
  // Verified indirectly: the only auth call in the layout is getSessionFast()
  // which reads the cookie and never calls getUser(). This test ensures neither
  // getUser nor getCachedUser appear in the call graph.
  // -------------------------------------------------------------------------

  it('makes zero getUser() calls in the happy path (fast-path guarantee)', async () => {
    setupAdminSession();
    const { default: DashboardLayout } = await import('@/app/dashboard/layout');
    const { getCachedUser } = await import('@/lib/auth/guards');

    await DashboardLayout({ children: null });

    // getCachedUser is the only entry point to getUser() in this codebase.
    // If it was never called, getUser() was never called either.
    expect(getCachedUser).not.toHaveBeenCalled();
  });
});
