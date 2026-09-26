/**
 * POST /api/cron/agent-dispatch
 * Backstop drain of agent_jobs — the primary drain is the instrumentation.ts
 * interval (src/instrumentation.ts), which runs as long as the Fly machine is
 * warm. This cron exists for the gap right after a machine resumes from
 * suspend, before the interval has had a chance to run, and as a fallback if
 * the in-process interval ever dies silently.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (constant-time compare — AC10).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { drainAgentJobs } from '@/lib/agent/jobs';
import { registerAgentJobHandlers } from '@/lib/agent/job-handlers';
import { sweepStalePendingInbound } from '@/lib/agent/whatsapp-dispatch';
import { ensureCalendarSyncJobs } from '@/lib/calendar/sync';
import { scanSpeedToLead, scanVisitConfirmationCalls } from '@/lib/agent/voice/scanners';
import { withDbRetry } from '@/lib/db/retry';
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
    // Phase 8 (item W): outbound-call scanners are triggers, not hooks — run
    // them before draining so anything they queue gets picked up in this
    // same invocation. No-op cheaply when voice/the policy is off (default).
    let voiceScanned = { speedToLead: 0, visitConfirmation: 0 };
    try {
      const speedToLead = await withDbRetry(() => scanSpeedToLead(), 'cron/agent-dispatch:voice-scan-stl');
      const visitConfirmation = await withDbRetry(() => scanVisitConfirmationCalls(), 'cron/agent-dispatch:voice-scan-vc');
      voiceScanned = { speedToLead, visitConfirmation };
    } catch (e) {
      log.error('[cron/agent-dispatch] voice scan failed', { error: e instanceof Error ? e.message : 'unknown' });
    }

    const result = await withDbRetry(() => drainAgentJobs(50), 'cron/agent-dispatch');
    const swept = await withDbRetry(() => sweepStalePendingInbound(), 'cron/agent-dispatch:sweep');
    let calendarSyncsEnqueued = 0;
    try {
      calendarSyncsEnqueued = await withDbRetry(() => ensureCalendarSyncJobs(), 'cron/agent-dispatch:calendar-sync');
    } catch (e) {
      log.error('[cron/agent-dispatch] ensureCalendarSyncJobs failed', { error: e instanceof Error ? e.message : 'unknown' });
    }
    log.info('[cron/agent-dispatch] run complete', { ...result, swept, calendarSyncsEnqueued, voiceScanned });
    return NextResponse.json({ status: 'ok', ...result, swept, calendarSyncsEnqueued, voiceScanned });
  } catch (e) {
    log.error('[cron/agent-dispatch] exception', { error: e instanceof Error ? e.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cron failed' } },
      { status: 500 }
    );
  }
}
