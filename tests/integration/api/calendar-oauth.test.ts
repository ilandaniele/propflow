/**
 * Integration tests for GET /api/calendar/google/callback (item C).
 *
 * Item B's OAuth/connections modules (src/lib/calendar/google/oauth.ts,
 * src/lib/calendar/connections.ts) are not built yet — they are mocked here
 * per the blueprint's frozen contracts (§3.1, §3.2), not stubbed as real
 * files. This suite documents the callback's state-cookie verification and
 * the happy path; it will resolve against the real modules once item B lands.
 *
 * Covers (blueprint §4):
 * - A missing state cookie redirects to error:state without calling exchangeCode.
 * - A mismatched profile in the cookie redirects to error:state without exchangeCode.
 * - An expired/tampered cookie (decodeStateCookie -> null) redirects to error:state.
 * - The happy path calls saveConnection with the ctx org/profile, never with query data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';
const OTHER_ORG_UUID = '550e8400-e29b-41d4-a716-446655440099';
const PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440014';
const OTHER_PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440015';

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => ({
    userId: 'admin-uuid',
    orgId: ORG_UUID,
    role: 'admin',
    profile: { id: PROFILE_UUID, email: 'advisor@propflow.test' },
  })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockDecodeStateCookie = vi.fn();
const mockExchangeCode = vi.fn();

vi.mock('@/lib/calendar/google/oauth', () => ({
  decodeStateCookie: (...args: unknown[]) => mockDecodeStateCookie(...args),
  exchangeCode: (...args: unknown[]) => mockExchangeCode(...args),
  CALENDAR_STATE_COOKIE: 'pf_cal_oauth',
}));

const mockSaveConnection = vi.fn();

vi.mock('@/lib/calendar/connections', () => ({
  saveConnection: (...args: unknown[]) => mockSaveConnection(...args),
}));

async function callCallback(url: string, cookieValue?: string) {
  const { GET } = await import('@/app/api/calendar/google/callback/route');
  const request = new NextRequest(url, {
    headers: cookieValue ? { cookie: `pf_cal_oauth=${cookieValue}` } : undefined,
  });
  return GET(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeStateCookie.mockImplementation(() => null);
  mockExchangeCode.mockImplementation(async () => ({
    refreshToken: 'rt',
    accessToken: 'at',
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'],
    email: 'advisor@gmail.com',
  }));
  mockSaveConnection.mockImplementation(async () => ({ id: 'conn-1' }));
});

describe('missing state cookie', () => {
  it('redirects to error:state and never calls exchangeCode', async () => {
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=abc&code=xyz');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('calendar=error:state');
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });

  it('clears the state cookie scoped to the same path it was set on, so the browser actually deletes it', async () => {
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=abc&code=xyz');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('pf_cal_oauth=');
    expect(setCookie).toContain('Path=/api/calendar/google');
  });
});

describe('expired or tampered cookie', () => {
  it('redirects to error:state when decodeStateCookie returns null', async () => {
    mockDecodeStateCookie.mockImplementation(() => null);
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=abc&code=xyz', 'garbage');
    expect(response.headers.get('location')).toContain('calendar=error:state');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });
});

describe('mismatched profile', () => {
  it('redirects to error:state when the cookie profileId does not match ctx', async () => {
    mockDecodeStateCookie.mockImplementation(() => ({
      state: 'abc',
      verifier: 'v',
      orgId: ORG_UUID,
      profileId: OTHER_PROFILE_UUID,
      exp: Math.floor(Date.now() / 1000) + 600,
    }));
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=abc&code=xyz', 'signed');
    expect(response.headers.get('location')).toContain('calendar=error:state');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('redirects to error:state when the cookie orgId does not match ctx', async () => {
    mockDecodeStateCookie.mockImplementation(() => ({
      state: 'abc',
      verifier: 'v',
      orgId: OTHER_ORG_UUID,
      profileId: PROFILE_UUID,
      exp: Math.floor(Date.now() / 1000) + 600,
    }));
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=abc&code=xyz', 'signed');
    expect(response.headers.get('location')).toContain('calendar=error:state');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('redirects to error:state when the query state does not match the cookie state', async () => {
    mockDecodeStateCookie.mockImplementation(() => ({
      state: 'expected-state',
      verifier: 'v',
      orgId: ORG_UUID,
      profileId: PROFILE_UUID,
      exp: Math.floor(Date.now() / 1000) + 600,
    }));
    const response = await callCallback('https://app.test/api/calendar/google/callback?state=wrong-state&code=xyz', 'signed');
    expect(response.headers.get('location')).toContain('calendar=error:state');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('calls saveConnection with the ctx org/profile, never with query data', async () => {
    mockDecodeStateCookie.mockImplementation(() => ({
      state: 'matching-state',
      verifier: 'verifier-value',
      orgId: ORG_UUID,
      profileId: PROFILE_UUID,
      exp: Math.floor(Date.now() / 1000) + 600,
    }));
    const response = await callCallback(
      'https://app.test/api/calendar/google/callback?state=matching-state&code=auth-code-123',
      'signed',
    );
    expect(mockExchangeCode).toHaveBeenCalledWith('auth-code-123', 'verifier-value');
    expect(mockSaveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_UUID, profileId: PROFILE_UUID, googleEmail: 'advisor@gmail.com' }),
    );
    expect(response.headers.get('location')).toContain('calendar=connected');

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Path=/api/calendar/google');
  });
});

describe('access_denied from Google', () => {
  it('redirects to error:denied without exchanging the code', async () => {
    mockDecodeStateCookie.mockImplementation(() => ({
      state: 'matching-state',
      verifier: 'verifier-value',
      orgId: ORG_UUID,
      profileId: PROFILE_UUID,
      exp: Math.floor(Date.now() / 1000) + 600,
    }));
    const response = await callCallback(
      'https://app.test/api/calendar/google/callback?state=matching-state&error=access_denied',
      'signed',
    );
    expect(response.headers.get('location')).toContain('calendar=error:denied');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });
});
