/**
 * GET /api/portal/notifications/unread-count
 *
 * Returns the number of unread notification_inbox rows for the authenticated
 * tenant (rows where read_at IS NULL).
 *
 * Auth: requireTenant() → getCachedUser() → getUser() — full JWT revalidation.
 * This is intentional: the notification count is not a layout cosmetic — it is
 * fetched client-side by NotificationBadge after the layout has already
 * streamed. Defense-in-depth is preserved (spec IC4).
 *
 * Rate limited: 100 requests / 60s / userId via checkRateLimit.
 *
 * Response 200: { "count": number }
 * Response 401: { "error": { "code": "UNAUTHENTICATED", "message": "Login required" } }
 * Response 403: { "error": { "code": "FORBIDDEN", "message": "Tenant role required" } }
 * Response 500: { "error": { "code": "INTERNAL", "message": "Failed to load notifications" } }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(): Promise<NextResponse> {
  // 1. Authenticate — full JWT revalidation via getUser() (defense-in-depth)
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

  // 3. Query notification_inbox — RLS ensures tenant sees only their own rows
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notification_inbox')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', ctx.userId)
    .is('read_at', null);

  if (error) {
    log.error('[unread-count] notification_inbox query failed', { code: error.code });
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Failed to load notifications' } },
      { status: 500 }
    );
  }

  return NextResponse.json({ count: count ?? 0 });
}
