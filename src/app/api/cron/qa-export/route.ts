/**
 * POST /api/cron/qa-export
 * Weekly QA export (handoffs + complaints), one CSV per org per week —
 * see src/lib/agent/qa-export.ts. Runs Monday 07:00 Lima (12:00 UTC).
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 * Idempotency: UNIQUE(org_id, week_start) on qa_exports.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runWeeklyQaExports } from '@/lib/agent/qa-export';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/qa-export] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/qa-export] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    const result = await withDbRetry(() => runWeeklyQaExports(), 'cron/qa-export');
    log.info('[cron/qa-export] run complete', result);
    return NextResponse.json({ status: 'ok', ...result });
  } catch (e) {
    log.error('[cron/qa-export] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
