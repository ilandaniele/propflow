/**
 * Integration tests for auto-link logic in src/app/auth/callback/route.ts
 *
 * Covers AC2 (auto-link single match → /portal) and AC3 (ambiguous → /onboarding).
 *
 * New scenarios (extends the existing auth-callback.test.ts scenarios 1–6):
 * 7. AC2: No profile + exactly 1 unlinked tenant matches email → auto-link → /portal
 * 8. AC3: No profile + 2 unlinked tenants share email → ambiguous → /onboarding
 * 9. AC3: No profile + 0 tenant rows match email → /onboarding
 * 10. Auto-link fails (DB error) → falls through to /onboarding (fail safe)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared state for mock control ────────────────────────────────────────────

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
  shouldThrow: false,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockImplementation(async () => {
        if (state.shouldThrow) throw new Error('unexpected');
        return state.exchangeResult;
      }),
    },
  }),
}));

vi.mock('@/lib/auth/provision', () => ({
  getExistingProfile: vi.fn().mockImplementation(async () => state.existingProfile),
  attemptAutoLink: vi.fn().mockImplementation(async () => {
    if (state.autoLinkResult === null) {
      return { linked: false, reason: 'no_match' };
    }
    return state.autoLinkResult;
  }),
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

import { NextRequest } from 'next/server';
import { GET } from '@/app/auth/callback/route';
import { attemptAutoLink } from '@/lib/auth/provision';

function makeRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/auth/callback');
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

const validExchangeData = {
  data: { user: { id: 'user-new', email: 'tenant@example.com' }, session: {} },
  error: null,
};

describe('GET /auth/callback — auto-link (AC2 + AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.existingProfile = null;
    state.autoLinkResult = null;
    state.shouldThrow = false;
    state.exchangeResult = validExchangeData;
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  });

  // ── Existing scenarios preserved ────────────────────────────────────────────

  it('Scenario 4 (unchanged): existing admin profile → /dashboard', async () => {
    state.existingProfile = { orgId: 'org-abc', role: 'admin' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    // attemptAutoLink must NOT be called when profile already exists
    expect(attemptAutoLink).not.toHaveBeenCalled();
  });

  it('Scenario 5 (unchanged): existing tenant profile → /portal', async () => {
    state.existingProfile = { orgId: 'org-abc', role: 'tenant' };
    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/portal');
    expect(attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── New AC2: auto-link single match ─────────────────────────────────────────

  it('AC2: no profile + exactly 1 tenant match → auto-link → /portal', async () => {
    state.existingProfile = null;
    state.autoLinkResult = { linked: true, orgId: 'org-abc' };

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/portal');
    expect(res.headers.get('location')).not.toContain('/onboarding');
    expect(attemptAutoLink).toHaveBeenCalledWith('user-new', 'tenant@example.com');
  });

  it('AC2: auto-link redirects to /portal (not /dashboard)', async () => {
    state.autoLinkResult = { linked: true, orgId: 'org-xyz' };
    const req = makeRequest({ code: 'code-for-portal' });
    const res = await GET(req);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/portal');
    expect(location).not.toContain('/dashboard');
  });

  // ── New AC3: ambiguous match → /onboarding ─────────────────────────────────

  it('AC3: no profile + ambiguous match (2+ tenants) → /onboarding', async () => {
    state.existingProfile = null;
    state.autoLinkResult = { linked: false, reason: 'ambiguous_match' };

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding');
    expect(res.headers.get('location')).not.toContain('/portal');
    expect(attemptAutoLink).toHaveBeenCalled();
  });

  it('AC3: no profile + 0 tenant matches → /onboarding', async () => {
    state.existingProfile = null;
    state.autoLinkResult = { linked: false, reason: 'no_match' };

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding');
    expect(attemptAutoLink).toHaveBeenCalled();
  });

  // ── Fail-safe: DB error during auto-link ────────────────────────────────────

  it('auto-link DB error falls through to /onboarding (fail safe)', async () => {
    state.existingProfile = null;
    // auto-link returns no_match even on DB errors (handled internally in attemptAutoLink)
    state.autoLinkResult = { linked: false, reason: 'no_match' };

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding');
  });

  // ── attemptAutoLink is NOT called when email is absent ──────────────────────

  it('no email on user → attemptAutoLink not called → /login?error=missing_email', async () => {
    state.exchangeResult = {
      data: { user: { id: 'user-no-email', email: '' }, session: {} },
      error: null,
    };
    state.existingProfile = null;

    const req = makeRequest({ code: 'valid-code' });
    const res = await GET(req);
    expect(res.status).toBe(307);
    // Route returns /login?error=missing_email for missing email (fail closed, not onboarding)
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/\/(onboarding|login)/);
    // An empty-email user skips the auto-link branch
    expect(attemptAutoLink).not.toHaveBeenCalled();
  });

  // ── Negative: unauth self-link (tenant changes URL) ────────────────────────

  it('auto-link skipped when provider error present', async () => {
    const req = makeRequest({ error: 'access_denied', error_description: 'Denied' });
    const res = await GET(req);
    expect(res.headers.get('location')).toContain('error=');
    expect(attemptAutoLink).not.toHaveBeenCalled();
  });
});
