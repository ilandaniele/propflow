/**
 * Unit tests for src/lib/calendar/google/oauth.ts (item B, blueprint §3.9).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.AUTH_GOOGLE_ID = 'client-id';
  process.env.AUTH_GOOGLE_SECRET = 'client-secret';
  process.env.AUTH_SECRET = 'super-secret-value';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test';
  delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

import {
  buildAuthUrl,
  createPkcePair,
  decodeStateCookie,
  encodeStateCookie,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
} from '@/lib/calendar/google/oauth';
import { CalendarAuthError, GoogleApiError, GOOGLE_CALENDAR_SCOPES } from '@/lib/calendar/types';

// ─── buildAuthUrl ────────────────────────────────────────────────────────────

describe('buildAuthUrl', () => {
  it('includes every required param and the PKCE challenge', () => {
    const { challenge } = createPkcePair();
    const url = new URL(buildAuthUrl({ state: 'abc123', codeChallenge: challenge, loginHint: 'advisor@propflow.test' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/calendar/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('state')).toBe('abc123');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('login_hint')).toBe('advisor@propflow.test');
    const scope = url.searchParams.get('scope') ?? '';
    for (const s of GOOGLE_CALENDAR_SCOPES) expect(scope).toContain(s);
    expect(scope).toContain('openid');
    expect(scope).toContain('email');
  });

  it('omits login_hint when not provided', () => {
    const { challenge } = createPkcePair();
    const url = new URL(buildAuthUrl({ state: 'abc', codeChallenge: challenge }));
    expect(url.searchParams.has('login_hint')).toBe(false);
  });
});

// ─── State cookie ────────────────────────────────────────────────────────────

describe('state cookie', () => {
  const cookie = { state: 'the-state', verifier: 'the-verifier', orgId: 'org-1', profileId: 'profile-1', exp: Math.floor(Date.now() / 1000) + 600 };

  it('round-trips', () => {
    const encoded = encodeStateCookie(cookie);
    const decoded = decodeStateCookie(encoded);
    expect(decoded).toEqual(cookie);
  });

  it('returns null for a tampered cookie', () => {
    const encoded = encodeStateCookie(cookie);
    const [payload, sig] = encoded.split('.');
    const tampered = `${payload}x.${sig}`;
    expect(decodeStateCookie(tampered)).toBeNull();
  });

  it('returns null for an expired cookie', () => {
    const encoded = encodeStateCookie({ ...cookie, exp: Math.floor(Date.now() / 1000) - 10 });
    expect(decodeStateCookie(encoded)).toBeNull();
  });

  it('returns null when signed with a different secret', () => {
    const encoded = encodeStateCookie(cookie);
    process.env.AUTH_SECRET = 'a-different-secret';
    expect(decodeStateCookie(encoded)).toBeNull();
  });

  it('returns null for a missing cookie', () => {
    expect(decodeStateCookie(undefined)).toBeNull();
  });
});

// ─── exchangeCode ────────────────────────────────────────────────────────────

describe('exchangeCode', () => {
  function idToken(email: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email })).toString('base64url');
    return `${header}.${payload}.signature`;
  }

  it('resolves refreshToken/accessToken/scopes/email on a full grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: [...GOOGLE_CALENDAR_SCOPES, 'openid', 'email'].join(' '),
      id_token: idToken('advisor@gmail.com'),
    }), { status: 200 })));

    const result = await exchangeCode('auth-code', 'verifier');
    expect(result.refreshToken).toBe('rt');
    expect(result.accessToken).toBe('at');
    expect(result.email).toBe('advisor@gmail.com');
    expect(result.scopes).toEqual(expect.arrayContaining([...GOOGLE_CALENDAR_SCOPES]));
  });

  it('throws scope_missing when a required scope is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'openid email https://www.googleapis.com/auth/calendar.events',
      id_token: idToken('advisor@gmail.com'),
    }), { status: 200 })));

    await expect(exchangeCode('auth-code', 'verifier')).rejects.toMatchObject({ reason: 'scope_missing' });
  });

  it('throws no_refresh_token when Google omits the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'at',
      expires_in: 3600,
      scope: [...GOOGLE_CALENDAR_SCOPES, 'openid', 'email'].join(' '),
      id_token: idToken('advisor@gmail.com'),
    }), { status: 200 })));

    await expect(exchangeCode('auth-code', 'verifier')).rejects.toMatchObject({ reason: 'no_refresh_token' });
  });

  it('gives CalendarAuthError on invalid_grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(exchangeCode('bad-code', 'verifier')).rejects.toBeInstanceOf(CalendarAuthError);
  });

  it('gives GoogleApiError for other endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })));
    await expect(exchangeCode('code', 'verifier')).rejects.toBeInstanceOf(GoogleApiError);
  });
});

// ─── refreshAccessToken ──────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('resolves a fresh access token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-at', expires_in: 3600 }), { status: 200 })));
    const result = await refreshAccessToken('rt');
    expect(result.accessToken).toBe('new-at');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives CalendarAuthError on invalid_grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(refreshAccessToken('revoked-rt')).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

// ─── revokeToken ─────────────────────────────────────────────────────────────

describe('revokeToken', () => {
  it('sends a bounded abort signal so a hung revoke endpoint cannot block disconnect', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeToken('some-refresh-token');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is best-effort: swallows a network failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(revokeToken('some-refresh-token')).resolves.toBeUndefined();
  });
});
