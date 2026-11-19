/**
 * POST /api/cron/agent-dispatch
 * Drains agent_jobs. Called every minute by the Cron Trigger (worker.ts).
 *
 * POST /api/cron/agent-dispatch?sweep=1
 * Runs the periodic sweep instead of the drain (src/lib/cron/agent-sweep.ts):
 * stale-inbound sweep, calendar-sync backstop, voice scanners. Called every
 * 5 minutes, before the drain of the same tick.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { drainAgentJobs } from '@/lib/agent/jobs';
import { registerAgentJobHandlers } from '@/lib/agent/job-handlers';
import { runAgentSweep } from '@/lib/cron/agent-sweep';
import { log } from '@/lib/log';

registerAgentJobHandlers();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.warn('[cron/agent-dispatch] CRON_SECRET not configured');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron secret not configured' } },
      { status: 503 }
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8');
  const actual = Buffer.from(authHeader, 'utf8');

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    log.warn('[cron/agent-dispatch] unauthorized attempt');
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } },
      { status: 401 }
    );
  }

  try {
    if (request.nextUrl.searchParams.get('sweep') === '1') {
      const swept = await runAgentSweep();
      log.info('[cron/agent-dispatch] sweep complete', swept);
      return NextResponse.json({ status: 'ok', ...swept });
    }

    const result = await drainAgentJobs(50);
    log.info('[cron/agent-dispatch] run complete', { ...result });
    return NextResponse.json({ status: 'ok', ...result });
  } catch (e) {
    log.error('[cron/agent-dispatch] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
