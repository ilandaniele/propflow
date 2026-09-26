/**
 * POST /api/cron/voice-reactivation
 *
 * The reactivation scanner (src/lib/agent/voice/scanners.ts's
 * scanReactivationCalls) also runs every ~60s from instrumentation.ts, but
 * that only helps while the Fly machine is warm. This cron is the primary
 * trigger for orgs that would otherwise sit suspended most of the day —
 * scheduled once daily (see .github/workflows/cron-dispatch.yml), not every
 * few minutes like the other scanners, since reactivation calls are meant to
 * be a low-frequency nudge, not a live-latency path like speed-to-lead.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare), same
 * pattern as every other /api/cron/* route.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { scanReactivationCalls } from '@/lib/agent/voice/scanners';
import { registerAgentJobHandlers } from '@/lib/agent/job-handlers';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

registerAgentJobHandlers();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/voice-reactivation] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/voice-reactivation] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    const queued = await withDbRetry(() => scanReactivationCalls(), 'cron/voice-reactivation');
    log.info('[cron/voice-reactivation] run complete', { queued });
    return NextResponse.json({ status: 'ok', queued });
  } catch (e) {
    log.error('[cron/voice-reactivation] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
