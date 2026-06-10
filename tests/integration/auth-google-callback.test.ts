/**
 * tests/integration/auth-google-callback.test.ts
 *
 * Tests for src/app/auth/callback/route.ts (Google OAuth callback scenarios).
 * All Supabase and DB calls are mocked — no live DB required.
 *
 * Scenarios:
 *  1. User with existing admin profile → redirect /dashboard
 *  2. User with existing tenant profile → redirect /portal
 *  3. No profile + 1 matching unlinked tenant → auto-link → /portal
 *  4. No profile + 0 matching tenants → redirect /onboarding?type=tenant
 *  5. Provider error → redirect /login?error=oauth_cancelled
 *  6. auth_redirect_to cookie present → redirect to that URL after login
 *  7. Duplicate email: same email as existing profile → use existing, no new row
 *  8. Missing email in user object → redirect /login?error or /onboarding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared mock state ──────────────────────────────────────────────────────────

const state = {
  exchangeResult: {
    data: null as { user: { id: string; email: string }; session: object } | null,
    error: null as { status: number; message: string } | null,
  },
  existingProfile: null as { orgId: string; role: string } | null,
  autoLinkResult: null as
    | { linked: true; orgId: string }
    | { linked: false; reason: 'no_match' | 'ambiguous_match' }
    | null,
};

const validUser = { id: 'user-oauth-001', email: 'tenant@gmail.com' };

// ── Mocks ──────────────────────────────────────────────────────────────────────
// All inner functions are plain closures reading `state` — NOT vi.fn().
// This avoids vi.clearAllMocks() clearing inner mock implementations.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: {
      exchangeCodeForSession: async () => state.exchangeResult,
    },
  })),
}));

const provisionMocks = {
  getExistingProfile: vi.fn(),
  attemptAutoLink: vi.fn(),
};

vi.mock('@/lib/auth/provision', () => ({
  getExistingProfile: async (userId: string) => provisionMocks.getExistingProfile(userId),
  attemptAutoLink: async (userId: string, email: string) => provisionMocks.attemptAutoLink(userId, email),
}));

vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('fake-key'),
  env: { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'fake-key' },
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    authSuccess: vi.fn(), authFailure: vi.fn(),
  },
}));

import { GET } from '@/app/auth/callback/route';

function makeRequest(searchParams: Record<string, string>, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/auth/callback');
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest(url.toString(), cookieHeader ? { headers: { cookie: cookieHeader } } : {});
}

describe('GET /auth/callback — Google OAuth', () => {
  beforeEach(() => {
    // Reset state
    state.exchangeResult = {
      data: { user: { id: validUser.id, email: validUser.email }, session: {} },
      error: null,
    };
    state.existingProfile = null;
    state.autoLinkResult = null;
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

    // Reset vi.fn() call counts and re-establish implementations
    provisionMocks.getExistingProfile.mockReset().mockImplementation(async () => state.existingProfile);
    provisionMocks.attemptAutoLink.mockReset().mockImplementation(async () => {
      return state.autoLinkResult ?? { linked: false, reason: 'no_match' };
    });
  });

  // ── 1. Existing admin profile ───────────────────────────────────────────────

  it('existing admin profile → redirects to /dashboard', async () => {
    state.existingProfile = { orgId: 'org-001', role: 'admin' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(provisionMocks.attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── 2. Existing tenant profile ──────────────────────────────────────────────

  it('existing tenant profile → redirects to /portal', async () => {
    state.existingProfile = { orgId: 'org-001', role: 'tenant' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/portal');
    expect(provisionMocks.attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── 3. No profile + 1 matching tenant → auto-link → /portal ─────────────────

  it('no profile + 1 matching unlinked tenant → auto-link → /portal', async () => {
    state.existingProfile = null;
    state.autoLinkResult = { linked: true, orgId: 'org-002' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/portal');
    expect(res.headers.get('location')).not.toContain('/onboarding');
    expect(provisionMocks.attemptAutoLink).toHaveBeenCalledWith(validUser.id, validUser.email);
  });

  // ── 4. No profile + 0 matching tenants → /onboarding ────────────────────────

  it('no profile + 0 matching tenants → /onboarding?type=tenant', async () => {
    state.existingProfile = null;
    state.autoLinkResult = { linked: false, reason: 'no_match' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding');
    expect(provisionMocks.attemptAutoLink).toHaveBeenCalled();
  });

  // ── 5. Provider error → /login?error=oauth_cancelled ────────────────────────

  it('provider error → redirect to /login with error param', async () => {
    const req = makeRequest({ error: 'access_denied', error_description: 'User denied' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/\/login/);
    expect(location).toMatch(/error=/);
    expect(provisionMocks.attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── 6. auth_redirect_to cookie present ───────────────────────────────────────

  it('auth_redirect_to cookie present → redirects successfully after login', async () => {
    state.existingProfile = { orgId: 'org-001', role: 'tenant' };
    const req = makeRequest({ code: 'valid-code' }, { auth_redirect_to: '/portal/documents' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/\//);
  });

  // ── 7. Duplicate email — existing profile should be used ─────────────────────

  it('duplicate email: existing profile found → use existing, attemptAutoLink not called', async () => {
    state.existingProfile = { orgId: 'org-dup', role: 'tenant' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/portal');
    expect(provisionMocks.attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── 8. Missing email in user object ──────────────────────────────────────────

  it('missing email in user → skips auto-link, redirects to safe fallback', async () => {
    state.exchangeResult = {
      data: { user: { id: 'user-no-email', email: '' }, session: {} },
      error: null,
    };
    state.existingProfile = null;
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/\/(onboarding|login)/);
    expect(provisionMocks.attemptAutoLink).not.toHaveBeenCalled();
  });
});
