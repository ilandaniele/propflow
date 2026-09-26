/**
 * POST /api/cron/lead-alerts
 * Opt-in cold-lead listing alerts — see src/lib/leads/listing-alerts.ts.
 * Scheduled daily 09:00 Lima (14:00 UTC) by .github/workflows/cron-dispatch.yml
 * (item G).
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 * Idempotency: UNIQUE(lead_id, listing_id) on lead_listing_alerts.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runListingAlertScan } from '@/lib/leads/listing-alerts';
import { sweepStaleFollowups } from '@/lib/leads/followups';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/lead-alerts] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/lead-alerts] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    const result = await withDbRetry(() => runListingAlertScan(), 'cron/lead-alerts');
    const staleFollowups = await withDbRetry(() => sweepStaleFollowups(), 'cron/lead-alerts:sweep');
    log.info('[cron/lead-alerts] run complete', { ...result, staleFollowups });
    return NextResponse.json({ status: 'ok', ...result, staleFollowups });
  } catch (e) {
    log.error('[cron/lead-alerts] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
