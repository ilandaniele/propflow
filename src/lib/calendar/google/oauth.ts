/**
 * Google OAuth (PKCE, authorization-code exchange, refresh, revoke) for the
 * Calendar integration — fetch only, no `googleapis` dependency (blueprint
 * assumption 2). Item C's routes (connect/callback) are the only callers.
 *
 * The OAuth client is the app's existing GCP client (AUTH_GOOGLE_ID /
 * AUTH_GOOGLE_SECRET, shared with NextAuth's Google provider), but with its
 * own redirect URI and its own signed state cookie — tokens never touch
 * NextAuth's `accounts` table.
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { GOOGLE_CALENDAR_SCOPES } from '../types';
import { CalendarAuthError, GoogleApiError } from '../types';

export const CALENDAR_STATE_COOKIE = 'pf_cal_oauth';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// The OpenID scope is required so the id_token carries the connected
// account's email; the calendar scopes are the two actually used at runtime.
const REQUESTED_SCOPES = ['openid', 'email', ...GOOGLE_CALENDAR_SCOPES];

function googleClientId(): string {
  const id = process.env.AUTH_GOOGLE_ID;
  if (!id) throw new Error('[calendar/google/oauth] AUTH_GOOGLE_ID is required');
  return id;
}

function googleClientSecret(): string {
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!secret) throw new Error('[calendar/google/oauth] AUTH_GOOGLE_SECRET is required');
  return secret;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('[calendar/google/oauth] AUTH_SECRET is required to sign the OAuth state cookie');
  return secret;
}

export function calendarRedirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${env.NEXT_PUBLIC_SITE_URL}/api/calendar/google/callback`;
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── Authorization URL ───────────────────────────────────────────────────────

export function buildAuthUrl(a: { state: string; codeChallenge: string; loginHint?: string | null }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', googleClientId());
  url.searchParams.set('redirect_uri', calendarRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', REQUESTED_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', a.state);
  url.searchParams.set('code_challenge', a.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (a.loginHint) url.searchParams.set('login_hint', a.loginHint);
  return url.toString();
}

// ─── Token exchange / refresh / revoke ──────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToTokenEndpoint(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    if (json.error === 'invalid_grant') throw new CalendarAuthError();
    // Never echo Google's error_description (may carry account-identifying detail) — code only.
    throw new GoogleApiError(res.status, json.error ?? null, `Google token endpoint error: ${json.error ?? res.status}`);
  }
  return json;
}

function decodeIdTokenEmail(idToken: string): string {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleApiError(400, 'invalid_id_token');
  // TLS-direct from Google's own token endpoint — no signature verification needed.
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { email?: string };
  if (!payload.email) throw new GoogleApiError(400, 'invalid_id_token');
  return payload.email;
}

export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<{ refreshToken: string; accessToken: string; expiresAt: Date; scopes: string[]; email: string }> {
  const json = await postToTokenEndpoint(
    new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: calendarRedirectUri(),
    }),
  );

  if (!json.refresh_token) throw new GoogleApiError(400, 'no_refresh_token');

  const grantedScopes = (json.scope ?? '').split(' ').filter(Boolean);
  const hasAllScopes = GOOGLE_CALENDAR_SCOPES.every((s) => grantedScopes.includes(s));
  if (!hasAllScopes) throw new GoogleApiError(400, 'scope_missing');

  if (!json.access_token || !json.id_token) throw new GoogleApiError(400, 'exchange');

  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    scopes: grantedScopes,
    email: decodeIdTokenEmail(json.id_token),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const json = await postToTokenEndpoint(
    new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  );
  if (!json.access_token) throw new GoogleApiError(400, 'exchange');
  return { accessToken: json.access_token, expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000) };
}

/** Best-effort — disconnecting must never fail because Google's revoke endpoint is down. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // swallow — disconnect proceeds regardless (blueprint §3.1)
  }
}

// ─── Signed, single-use OAuth state cookie ──────────────────────────────────

export interface OAuthStateCookie {
  state: string;
  verifier: string;
  orgId: string;
  profileId: string;
  exp: number; // epoch seconds
}

function signState(json: string): string {
  return createHmac('sha256', authSecret()).update(json).digest('base64url');
}

export function encodeStateCookie(v: OAuthStateCookie): string {
  const json = JSON.stringify(v);
  const payload = Buffer.from(json, 'utf8').toString('base64url');
  return `${payload}.${signState(json)}`;
}

export function decodeStateCookie(raw: string | undefined, now: Date = new Date()): OAuthStateCookie | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  let json: string;
  try {
    json = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = signState(json);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) return null;

  let parsed: OAuthStateCookie;
  try {
    parsed = JSON.parse(json) as OAuthStateCookie;
  } catch {
    return null;
  }
  if (
    typeof parsed.state !== 'string' ||
    typeof parsed.verifier !== 'string' ||
    typeof parsed.orgId !== 'string' ||
    typeof parsed.profileId !== 'string' ||
    typeof parsed.exp !== 'number'
  ) {
    return null;
  }
  if (Math.floor(now.getTime() / 1000) > parsed.exp) return null;

  return parsed;
}
