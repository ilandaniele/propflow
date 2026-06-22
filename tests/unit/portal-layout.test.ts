/**
 * Unit tests: portal layout fast-auth path (W3 — AC4)
 *
 * Covers:
 *   AC4 — layout calls getSessionFast() (NOT getUser / getCachedUser)
 *   AC4 — layout calls getProfileFast(session.user.id)
 *   AC4 — layout does NOT query notification_inbox during render
 *   AC4 — redirects to /login when session is null
 *   AC4 — redirects to /dashboard when profile role is not 'tenant'
 *   AC4 — renders without redirecting for a valid tenant session
 *
 * Test strategy:
 * - Mock getSessionFast from @/lib/supabase/server and getProfileFast from
 *   @/lib/auth/guards so we control their return values.
 * - Mock next/navigation redirect as a throwing sentinel (mirrors runtime behaviour).
 * - Mock TenantNav as a lightweight stub (not testing nav rendering here).
 * - Call PortalLayout as a plain async function — exercises control-flow logic
 *   without React rendering infrastructure.
 * - Assert Supabase createClient.from() is NEVER called with 'notification_inbox'
 *   during layout render (critical AC4 requirement).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Sentinel for redirect assertions (mirrors Next.js runtime — redirect throws)
// ---------------------------------------------------------------------------

class RedirectError extends Error {
  constructor(public readonly destination: string) {
    super(`REDIRECT:${destination}`);
    this.name = 'RedirectError';
  }
}

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock next/cache (transparent pass-through — same pattern as other layout tests)
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
};

// ---------------------------------------------------------------------------
// Track Supabase from() calls — used to assert notification_inbox is NOT queried
// ---------------------------------------------------------------------------

const fromCallTables: string[] = [];

// ---------------------------------------------------------------------------
// Mock fast-path helpers — the ONLY auth helpers the layout should call
// ---------------------------------------------------------------------------

const mockGetSessionFast = vi.fn(async () => mockState.session);
const mockGetProfileFast = vi.fn(async (_userId: string) => mockState.profile);

vi.mock('@/lib/supabase/server', () => ({
  getSessionFast: () => mockGetSessionFast(),
  // createClient is present so the import resolves — layout should NOT call it
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCallTables.push(table);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ count: 0})),
  createAdminServerClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      fromCallTables.push(table);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ count: 0, error: null })),
            single: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    }),
  })),
}));

vi.mock('@/lib/auth/guards', () => ({
  getProfileFast: (userId: string) => mockGetProfileFast(userId),
  getOrgNameFast: vi.fn(),
  getCachedUser: vi.fn(),
  getProfile: vi.fn(),
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  requireTenant: vi.fn(),
  getOrgScopedClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stub TenantNav so the layout can be called without DOM / React infra
// ---------------------------------------------------------------------------

vi.mock('@/components/shell/TenantNav', () => ({
  TenantNav: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server — getLocale() is a server-only API that throws in
// non-React-Server environments (including Vitest's jsdom/node). Return 'es'
// as the default locale; individual tests can override via mockResolvedValue.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn().mockResolvedValue('es'),
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
  getFormatter: vi.fn(),
  getNow: vi.fn(),
  getTimeZone: vi.fn(),
  getMessages: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
}

function setupAdminSession(userId = 'admin-1', orgId = 'org-1') {
  mockState.session = { user: { id: userId }, access_token: 'tok-admin' };
  mockState.profile = {
    id: userId,
    org_id: orgId,
    role: 'admin',
    full_name: 'Admin User',
    phone: null,
    email: 'admin@test.com',
  };
}

async function resetState() {
  mockState.session = null;
  mockState.profile = null;
  fromCallTables.length = 0;
  mockGetSessionFast.mockClear();
  mockGetProfileFast.mockClear();
  // Clear locale and component mocks so locale-specific tests start clean
  const { getLocale } = await import('next-intl/server');
  (getLocale as ReturnType<typeof vi.fn>).mockClear();
  const { TenantNav } = await import('@/components/shell/TenantNav');
  (TenantNav as ReturnType<typeof vi.fn>).mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PortalLayout — fast-auth path (AC4)', () => {
  beforeEach(resetState);

  // -------------------------------------------------------------------------
  // AC4: layout calls getSessionFast() (NOT getUser / getCachedUser)
  // -------------------------------------------------------------------------

  it('calls getSessionFast() to obtain the session', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await PortalLayout({ children: null });

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
  });

  it('does NOT call getCachedUser or getUser directly', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getCachedUser } = await import('@/lib/auth/guards');

    await PortalLayout({ children: null });

    expect(getCachedUser).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC4: layout calls getProfileFast(session.user.id)
  // -------------------------------------------------------------------------

  it('calls getProfileFast() with the session user id', async () => {
    setupTenantSession('tenant-abc', 'org-xyz');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await PortalLayout({ children: null });

    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledWith('tenant-abc');
  });

  // -------------------------------------------------------------------------
  // AC4: layout does NOT query notification_inbox during render
  // -------------------------------------------------------------------------

  it('does NOT query notification_inbox during layout render', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await PortalLayout({ children: null });

    expect(fromCallTables).not.toContain('notification_inbox');
  });

  // -------------------------------------------------------------------------
  // AC4: redirect to /login when session is null
  // -------------------------------------------------------------------------

  it('redirects to /login when session is null', async () => {
    // session remains null (resetState)
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/login')
    );

    // getProfileFast must NOT be called — short-circuit after null session
    expect(mockGetProfileFast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC4: redirect to /dashboard when role is not 'tenant' (e.g. 'admin')
  // -------------------------------------------------------------------------

  it("redirects to /dashboard when profile role is 'admin'", async () => {
    setupAdminSession('admin-1', 'org-1');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/dashboard')
    );

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
  });

  it('redirects to /dashboard when profile is null (no profile row)', async () => {
    mockState.session = { user: { id: 'orphan-user' }, access_token: 'tok' };
    mockState.profile = null;
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/dashboard')
    );

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // AC4: renders without redirecting for a valid tenant session
  // -------------------------------------------------------------------------

  it('renders without redirecting when session + tenant profile are valid', async () => {
    setupTenantSession('tenant-ok', 'org-ok');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).resolves.not.toThrow();

    expect(mockGetSessionFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    expect(fromCallTables).not.toContain('notification_inbox');
  });

  // -------------------------------------------------------------------------
  // AC4: zero getUser() calls in the happy path (fast-path guarantee)
  // -------------------------------------------------------------------------

  it('makes zero getUser() calls in the happy path', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getCachedUser } = await import('@/lib/auth/guards');

    await PortalLayout({ children: null });

    // getCachedUser is the only entry point to getUser() in this codebase.
    expect(getCachedUser).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Locale: getLocale() is called and currentLocale is forwarded to TenantNav
  // -------------------------------------------------------------------------

  it('calls getLocale() during layout render (locale wired into layout)', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getLocale } = await import('next-intl/server');

    // Default mock returns 'es' — layout must call getLocale() to get the locale
    await PortalLayout({ children: null });

    expect(getLocale).toHaveBeenCalledTimes(1);
  });

  it('renders without error when getLocale returns "en"', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getLocale } = await import('next-intl/server');

    (getLocale as ReturnType<typeof vi.fn>).mockResolvedValueOnce('en');

    // Layout must resolve cleanly — no redirect, no throw — for any supported locale
    await expect(PortalLayout({ children: null })).resolves.not.toThrow();
    expect(getLocale).toHaveBeenCalledTimes(1);
  });
});
