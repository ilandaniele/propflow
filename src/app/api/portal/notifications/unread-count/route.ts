/**
 * GET /api/portal/notifications/unread-count
 *
 * Returns the number of unread notification_inbox rows for the authenticated
 * tenant (rows where read_at IS NULL).
 *
 * Auth: requireTenant() → full JWT revalidation (defense-in-depth).
 * Rate limited: 100 requests / 60s / userId.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { notificationInbox } from '@/lib/db/schema';
import { eq, and, isNull, count as sqlCount } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(): Promise<NextResponse> {
  // 1. Authenticate — full JWT revalidation via requireTenant()
  let ctx;
  try {
    ctx = await requireTenant();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'FORBIDDEN') {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Tenant role required' } },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      { status: 401 }
    );
  }

  // 2. Rate limit — 100 req / 60s / userId
  const { success } = checkRateLimit(
    `notif-count:${ctx.userId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!success) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait before trying again.' } },
      { status: 429 }
    );
  }

  // 3. Count unread notifications — Drizzle (AC1, AC8: profile_id + org_id isolation)
  try {
    const rows = await db
      .select({ value: sqlCount() })
      .from(notificationInbox)
      .where(
        and(
          eq(notificationInbox.profileId, ctx.userId),
          eq(notificationInbox.orgId, ctx.orgId),
          isNull(notificationInbox.readAt)
        )
      );

    const count = Number(rows[0]?.value ?? 0);
    return NextResponse.json({ count });
  } catch (err) {
    log.error('[unread-count] notification_inbox query failed', { error: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Failed to load notifications' } },
      { status: 500 }
    );
  }
}
