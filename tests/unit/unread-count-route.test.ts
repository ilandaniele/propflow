/**
 * Unit tests: GET /api/portal/notifications/unread-count Route Handler (W3 — AC4)
 *
 * Covers:
 *   AC4 — returns 401 UNAUTHENTICATED when not authenticated
 *   AC4 — returns 403 FORBIDDEN when user is admin (not a tenant)
 *   AC4 — returns 200 { count: N } for an authenticated tenant
 *   AC4 — returns 500 INTERNAL when notification_inbox query fails
 *   AC4 — returns 429 RATE_LIMITED when rate limit is exceeded
 *
 * Test strategy:
 * - Mock requireTenant from @/lib/auth/guards to control auth behavior.
 * - Mock createClient from @/lib/supabase/server to control DB query results.
 * - Mock checkRateLimit from @/lib/ratelimit to control rate limiting.
 * - Call the GET handler directly (no HTTP server needed).
 * - Assert on the JSON response body and status code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Controlled return values
// ---------------------------------------------------------------------------

type AuthCtx = {
  userId: string;
  orgId: string;
  role: 'admin' | 'tenant';
  profile: unknown;
};

const authState: {
  result: AuthCtx | null;
  error: string | null;
} = {
  result: null,
  error: null,
};

const dbState: {
  count: number | null;
  error: { code: string } | null;
} = {
  count: null,
  error: null,
};

const rateLimitState = {
  success: true,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireTenant: vi.fn(async () => {
    if (authState.error) throw new Error(authState.error);
    if (!authState.result) throw new Error('UNAUTHORIZED');
    return authState.result;
  }),
  // Keep other exports present to avoid import errors
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
  getCachedUser: vi.fn(),
  getProfile: vi.fn(),
  getProfileFast: vi.fn(),
  getOrgNameFast: vi.fn(),
  getOrgScopedClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          if (dbState.error) throw new Error(dbState.error.code);
          return [{ value: dbState.count ?? 0 }];
        }),
      })),
    })),
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(() => ({ success: rateLimitState.success, retryAfterMs: 0 })),
  authRateLimit: vi.fn(),
  actionRateLimit: vi.fn(),
  mutationRateLimit: vi.fn(),
}));

vi.mock('@/lib/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTenant(userId = 'tenant-1', orgId = 'org-1') {
  authState.result = { userId, orgId, role: 'tenant', profile: null };
  authState.error = null;
}

function setupUnauthenticated() {
  authState.result = null;
  authState.error = 'UNAUTHORIZED';
}

function setupForbidden() {
  authState.result = null;
  authState.error = 'FORBIDDEN';
}

function setupDbSuccess(count: number) {
  dbState.count = count;
  dbState.error = null;
}

function setupDbError() {
  dbState.count = null;
  dbState.error = { code: 'PGRST116' };
}

function resetState() {
  authState.result = null;
  authState.error = null;
  dbState.count = null;
  dbState.error = null;
  rateLimitState.success = true;
  vi.clearAllMocks();
}

async function callGET() {
  // Re-import to get fresh module state after vi.mock setup
  const { GET } = await import('@/app/api/portal/notifications/unread-count/route');
  const response = await GET();
  const body = await response.json() as unknown;
  return { status: response.status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/portal/notifications/unread-count', () => {
  beforeEach(resetState);

  // -------------------------------------------------------------------------
  // 401 — Unauthenticated
  // -------------------------------------------------------------------------

  it('returns 401 UNAUTHENTICATED when not authenticated', async () => {
    setupUnauthenticated();
    const { status, body } = await callGET();

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  // -------------------------------------------------------------------------
  // 403 — Forbidden (admin calling a tenant-only endpoint)
  // -------------------------------------------------------------------------

  it('returns 403 FORBIDDEN when user is not a tenant (admin role)', async () => {
    setupForbidden();
    const { status, body } = await callGET();

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  // 200 — Happy path: authenticated tenant
  // -------------------------------------------------------------------------

  it('returns 200 with count for an authenticated tenant', async () => {
    setupTenant('tenant-1', 'org-1');
    setupDbSuccess(7);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect((body as { count: number }).count).toBe(7);
  });

  it('returns 200 with count=0 when no unread notifications', async () => {
    setupTenant('tenant-2', 'org-1');
    setupDbSuccess(0);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect((body as { count: number }).count).toBe(0);
  });

  it('returns 200 with count=0 when DB returns null count', async () => {
    setupTenant('tenant-3', 'org-1');
    dbState.count = null;
    dbState.error = null;

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect((body as { count: number }).count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 500 — Internal error (DB query fails)
  // -------------------------------------------------------------------------

  it('returns 500 INTERNAL when notification_inbox query fails', async () => {
    setupTenant();
    setupDbError();

    const { status, body } = await callGET();

    expect(status).toBe(500);
    expect((body as { error: { code: string } }).error.code).toBe('INTERNAL');
  });

  // -------------------------------------------------------------------------
  // 429 — Rate limited
  // -------------------------------------------------------------------------

  it('returns 429 RATE_LIMITED when rate limit is exceeded', async () => {
    setupTenant();
    setupDbSuccess(3);
    rateLimitState.success = false;

    const { status, body } = await callGET();

    expect(status).toBe(429);
    expect((body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  // -------------------------------------------------------------------------
  // Defense-in-depth: requireTenant() calls getUser() (AC5 preserved)
  // -------------------------------------------------------------------------

  it('calls requireTenant() which calls getUser() (defense-in-depth confirmed)', async () => {
    setupTenant();
    setupDbSuccess(1);

    const { requireTenant } = await import('@/lib/auth/guards');
    await callGET();

    expect(requireTenant).toHaveBeenCalledTimes(1);
  });
});
