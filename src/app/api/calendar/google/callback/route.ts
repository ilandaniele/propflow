/**
 * GET /api/calendar/google/callback
 *
 * Completes the Google Calendar OAuth flow started by
 * /api/calendar/google/connect (item C). Never under /api/auth/* (NextAuth's
 * own catch-all) — tokens never touch the `accounts` table.
 *
 * Flow (blueprint §4):
 *   1. requireAdmin.
 *   2. Decode + verify the signed state cookie: state matches
 *      (timingSafeEqual) AND cookie.profileId === ctx.profile.id AND
 *      cookie.orgId === ctx.orgId.
 *   3. Delete the cookie (single use), regardless of outcome.
 *   4. access_denied from Google -> ?calendar=error:denied.
 *   5. exchangeCode + saveConnection.
 *   6. Redirect to /dashboard/visits/availability?calendar=connected.
 *
 * Every failure redirects to ?calendar=error:<code> with codes
 * state|scope_missing|no_refresh_token|exchange. Google's own error text and
 * any token material are never echoed back to the client or logged — only
 * the error code.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { log } from '@/lib/log';
import { decodeStateCookie, exchangeCode, CALENDAR_STATE_COOKIE } from '@/lib/calendar/google/oauth';
import { saveConnection } from '@/lib/calendar/connections';
import { GoogleApiError } from '@/lib/calendar/types';

const AVAILABILITY_PATH = '/dashboard/visits/availability';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function errorRedirect(request: NextRequest, code: string): NextResponse {
  const response = NextResponse.redirect(new URL(`${AVAILABILITY_PATH}?calendar=error:${code}`, request.url));
  response.cookies.delete({ name: CALENDAR_STATE_COOKIE, path: '/api/calendar/google' });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const rawCookie = request.cookies.get(CALENDAR_STATE_COOKIE)?.value;
  const cookie = decodeStateCookie(rawCookie);

  const queryState = request.nextUrl.searchParams.get('state') ?? '';
  const errorParam = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');

  if (!cookie || !safeEqual(cookie.state, queryState) || cookie.profileId !== ctx.profile.id || cookie.orgId !== ctx.orgId) {
    log.warn('[calendar/callback] state mismatch or missing cookie', { orgId: ctx.orgId });
    return errorRedirect(request, 'state');
  }

  if (errorParam === 'access_denied') {
    log.info('[calendar/callback] user denied consent', { orgId: ctx.orgId });
    return errorRedirect(request, 'denied');
  }

  if (!code) {
    return errorRedirect(request, 'exchange');
  }

  try {
    const tokens = await exchangeCode(code, cookie.verifier);
    await saveConnection({
      orgId: ctx.orgId,
      profileId: ctx.profile.id,
      googleEmail: tokens.email,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
  } catch (e) {
    const errCode = e instanceof GoogleApiError && e.reason ? e.reason : 'exchange';
    log.error('[calendar/callback] exchange failed', { orgId: ctx.orgId, code: errCode });
    return errorRedirect(request, errCode);
  }

  log.info('[calendar/callback] connected', { orgId: ctx.orgId });
  const response = NextResponse.redirect(new URL(`${AVAILABILITY_PATH}?calendar=connected`, request.url));
  response.cookies.delete({ name: CALENDAR_STATE_COOKIE, path: '/api/calendar/google' });
  return response;
}
