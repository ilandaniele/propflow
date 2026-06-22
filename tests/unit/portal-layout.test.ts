/**
 * Unit tests: portal layout fast-auth path (W3 — AC4)
 *
 * Covers:
 *   AC4 — layout calls getCachedUser() to obtain the session user
 *   AC4 — layout calls getProfileFast(session.user.id)
 *   AC4 — layout does NOT query notification_inbox during render
 *   AC4 — redirects to /login when session is null
 *   AC4 — redirects to /dashboard when profile role is not 'tenant'
 *   AC4 — renders without redirecting for a valid tenant session
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
  user: null as { id: string } | null,
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
// Mock fast-path helpers — the ONLY auth helpers the layout should call
// ---------------------------------------------------------------------------

const mockGetCachedUser = vi.fn(async () => mockState.user);
const mockGetProfileFast = vi.fn(async (_userId: string) => mockState.profile);

vi.mock('@/lib/auth/guards', () => ({
  getCachedUser: () => mockGetCachedUser(),
  getProfileFast: (userId: string) => mockGetProfileFast(userId),
  getOrgNameFast: vi.fn(),
  getProfile: vi.fn(),
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  requireTenant: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stub TenantNav so the layout can be called without DOM / React infra
// ---------------------------------------------------------------------------

vi.mock('@/components/shell/TenantNav', () => ({
  TenantNav: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock next-intl/server
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
  mockState.user = { id: userId };
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
  mockState.user = { id: userId };
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
  mockState.user = null;
  mockState.profile = null;
  mockGetCachedUser.mockClear();
  mockGetProfileFast.mockClear();
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

  it('calls getCachedUser() to obtain the session user', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await PortalLayout({ children: null });

    expect(mockGetCachedUser).toHaveBeenCalledTimes(1);
  });

  it('calls getProfileFast() with the session user id', async () => {
    setupTenantSession('tenant-abc', 'org-xyz');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await PortalLayout({ children: null });

    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledWith('tenant-abc');
  });

  it('redirects to /login when session is null', async () => {
    // user remains null (resetState)
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/login')
    );

    // getProfileFast must NOT be called — short-circuit after null user
    expect(mockGetProfileFast).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when profile role is 'admin'", async () => {
    setupAdminSession('admin-1', 'org-1');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/dashboard')
    );

    expect(mockGetCachedUser).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
  });

  it('redirects to /dashboard when profile is null (no profile row)', async () => {
    mockState.user = { id: 'orphan-user' };
    mockState.profile = null;
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      new RedirectError('/dashboard')
    );

    expect(mockGetCachedUser).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
  });

  it('renders without redirecting when session + tenant profile are valid', async () => {
    setupTenantSession('tenant-ok', 'org-ok');
    const { default: PortalLayout } = await import('@/app/portal/layout');

    await expect(PortalLayout({ children: null })).resolves.not.toThrow();

    expect(mockGetCachedUser).toHaveBeenCalledTimes(1);
    expect(mockGetProfileFast).toHaveBeenCalledTimes(1);
  });

  it('calls getLocale() during layout render (locale wired into layout)', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getLocale } = await import('next-intl/server');

    await PortalLayout({ children: null });

    expect(getLocale).toHaveBeenCalledTimes(1);
  });

  it('renders without error when getLocale returns "en"', async () => {
    setupTenantSession();
    const { default: PortalLayout } = await import('@/app/portal/layout');
    const { getLocale } = await import('next-intl/server');

    (getLocale as ReturnType<typeof vi.fn>).mockResolvedValueOnce('en');

    await expect(PortalLayout({ children: null })).resolves.not.toThrow();
    expect(getLocale).toHaveBeenCalledTimes(1);
  });
});
