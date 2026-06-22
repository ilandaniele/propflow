/**
 * Integration tests for Permissions-Policy header behaviour in src/proxy.ts.
 *
 * Tests the per-pathname policy selection logic directly by calling proxy()
 * with a session cookie (NextAuth v5 — authjs.session-token) to simulate an
 * authenticated user.
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Helper: call proxy and extract the Permissions-Policy header
//
// The proxy (src/proxy.ts) uses NextAuth v5 — it checks for the presence of
// the `authjs.session-token` cookie to determine if a user is authenticated.
// We simulate an authenticated session by adding that cookie to the request.
// ---------------------------------------------------------------------------
async function getPermissionsPolicy(pathname: string, authenticated = true): Promise<string | null> {
  const { proxy } = await import('@/proxy');
  const url = `http://localhost${pathname}`;

  const headers: Record<string, string> = {};
  if (authenticated) {
    // NextAuth v5 uses `authjs.session-token` (HTTP) or `__Secure-authjs.session-token` (HTTPS)
    headers['cookie'] = 'authjs.session-token=test-token-value';
  }

  const req = new NextRequest(url, { method: 'GET', headers });
  const res = await proxy(req);
  return res.headers.get('Permissions-Policy');
}

describe('Permissions-Policy header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Portal routes — authenticated user → camera=(self)
  it('/portal/incidents/new → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal/incidents/new');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('/portal (root portal path) → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('/portal/payments → camera=(self), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/portal/payments');
    expect(policy).toBe('camera=(self), microphone=(), geolocation=()');
  });

  // Dashboard routes — authenticated admin → camera=()
  it('/dashboard/incidents → camera=(), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/dashboard/incidents');
    expect(policy).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('/dashboard (root) → camera=(), microphone=(), geolocation=()', async () => {
    const policy = await getPermissionsPolicy('/dashboard');
    expect(policy).toBe('camera=(), microphone=(), geolocation=()');
  });

  // Public route — unauthenticated (no session cookie)
  it('/ (public landing) → camera=(), microphone=(), geolocation=()', async () => {
    const { proxy } = await import('@/proxy');
    const req = new NextRequest('http://localhost/', { method: 'GET' });
    const res = await proxy(req);
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
