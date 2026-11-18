import { sweepStalePendingInbound } from '@/lib/agent/whatsapp-dispatch';
import { ensureCalendarSyncJobs } from '@/lib/calendar/sync';
import { scanSpeedToLead, scanVisitConfirmationCalls } from '@/lib/agent/voice/scanners';
import { failStaleCalls } from '@/lib/agent/voice/usage';
import { withDbRetry } from '@/lib/db/retry';
import { log } from '@/lib/log';

const SWEEP_STEPS = {
  staleInboundSwept: sweepStalePendingInbound,
  calendarSyncsEnqueued: ensureCalendarSyncJobs,
  speedToLeadCalls: scanSpeedToLead,
  visitConfirmationCalls: scanVisitConfirmationCalls,
  staleCallsFailed: failStaleCalls,
} satisfies Record<string, () => Promise<number>>;

export type AgentSweepResult = Record<keyof typeof SWEEP_STEPS, number> & { failed: number };

/** Runs every sweep step in series; a failing step is logged and counted, never thrown. */
export async function runAgentSweep(): Promise<AgentSweepResult> {
  const result = { failed: 0 } as AgentSweepResult;
  for (const [name, step] of Object.entries(SWEEP_STEPS) as [keyof typeof SWEEP_STEPS, () => Promise<number>][]) {
    try {
      result[name] = await withDbRetry(() => step(), `cron/agent-sweep:${name}`);
    } catch (e) {
      result[name] = 0;
      result.failed++;
      log.error('[cron/agent-sweep] step failed', { step: name, error: e instanceof Error ? e.message : 'unknown' });
    }
  }
  return result;
}
