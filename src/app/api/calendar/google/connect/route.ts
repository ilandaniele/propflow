/**
 * GET /api/calendar/google/connect
 *
 * Starts the Google Calendar OAuth flow for the signed-in advisor (item C).
 * This route must never live under /api/auth/* — that path is NextAuth's own
 * catch-all, and calendar tokens never touch the `accounts` table it manages.
 *
 * Flow (blueprint §4):
 *   1. requireAdmin — on failure, redirect to /login.
 *   2. The profile must be an advisor (an agent_advisor_settings row); if
 *      not, redirect back with ?calendar=error:not_advisor.
 *   3. Generate a PKCE pair plus a random 32-byte base64url state.
 *   4. Set the signed, single-use, 10-minute state cookie, scoped to
 *      /api/calendar/google.
 *   5. Redirect to Google's consent screen.
 *
 * Security: one connection per advisor profile — only the advisor can
 * connect their own calendar (assumption 5). The state cookie binds this
 * flow to ctx.orgId + ctx.profile.id so the callback can never be replayed
 * against a different profile or org.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentAdvisorSettings } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { log } from '@/lib/log';
import {
  buildAuthUrl,
  createPkcePair,
  encodeStateCookie,
  CALENDAR_STATE_COOKIE,
} from '@/lib/calendar/google/oauth';

const AVAILABILITY_PATH = '/dashboard/visits/availability';
const STATE_TTL_SECONDS = 600; // 10 minutes

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const advisorRows = await db
    .select({ id: agentAdvisorSettings.id })
    .from(agentAdvisorSettings)
    .where(and(eq(agentAdvisorSettings.orgId, ctx.orgId), eq(agentAdvisorSettings.profileId, ctx.profile.id)))
    .limit(1);

  if (!advisorRows[0]) {
    return NextResponse.redirect(new URL(`${AVAILABILITY_PATH}?calendar=error:not_advisor`, request.url));
  }

  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();

  const cookieValue = encodeStateCookie({
    state,
    verifier,
    orgId: ctx.orgId,
    profileId: ctx.profile.id,
    exp: Math.floor(now / 1000) + STATE_TTL_SECONDS,
  });

  const authUrl = buildAuthUrl({ state, codeChallenge: challenge, loginHint: ctx.profile.email ?? null });

  log.info('[calendar/connect] starting OAuth flow', { orgId: ctx.orgId });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(CALENDAR_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/calendar/google',
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
