/**
 * Integration tests for Permissions-Policy header behaviour in src/proxy.ts.
 *
 * Tests the per-pathname policy selection logic directly by calling proxy()
 * with mocked updateSession returning a user.
 *
 * Routes tested:
 *   1. /portal/*        → camera=(self), microphone=(), geolocation=()
 *   2. /dashboard/*     → camera=(), microphone=(), geolocation=()
 *   3. / (public)       → camera=(), microphone=(), geolocation=()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Polyfill crypto.randomUUID for test environment
// ---------------------------------------------------------------------------
if (!globalThis.crypto?.randomUUID) {
  const { randomUUID } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// updateSession mock factory — returns either an admin or tenant user.
// Declared at top-level so it can be overridden per-test via `mockUser`.
// ---------------------------------------------------------------------------
let mockUser: { id: string; app_metadata: { role: string } } | null = {
  id: 'tenant-id',
  app_metadata: { role: 'tenant' },
};

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(async (_req: unknown) => {
    const { NextResponse } = require('next/server');
    return {
      response: NextResponse.next(),
      user:     mockUser,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Helper: call proxy and extract the Permissions-Policy header
// ---------------------------------------------------------------------------
async function getPermissionsPolicy(
  pathname: string,
  role: 'admin' | 'tenant' = 'tenant'
): Promise<string | null> {
  mockUser = { id: 'test-user', app_metadata: { role } };
  const { proxy } = await import('@/proxy');
  const req = new NextRequest(`http://localhost${pathname}`, { method: 'GET' });
  const res = await proxy(req);
  return res.headers.get('Permissions-Policy');
}

describe('Permissions-Policy header', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
    vi.clearAllMocks();
  });

  // Portal routes — tenant user → camera=(self)
  it('/portal/incidents/new → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal/incidents/new', 'tenant');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('/portal (root portal path) → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal', 'tenant');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('/portal/payments → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal/payments', 'tenant');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  // Dashboard routes — admin user → camera=()
  it('/dashboard/incidents → camera=(), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/dashboard/incidents', 'admin');
    expect(policy).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('/dashboard (root) → camera=(), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/dashboard', 'admin');
    expect(policy).toBe('camera=(), microphone=(), geolocation=()');
  });

  // Public route — unauthenticated
  it('/ (public landing) → camera=(), microphone=(), geolocation=()', async () => {
    // For a public route with no user, proxy still sets the header before route guard check
    mockUser = null;
    const { proxy } = await import('@/proxy');
    const req = new NextRequest('http://localhost/', { method: 'GET' });
    const res = await proxy(req);
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
