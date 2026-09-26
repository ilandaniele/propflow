/**
 * Drains src/lib/agent/jobs.ts (agent_jobs) on an interval while the Fly
 * machine is warm. Fly's suspend/resume model means this interval dies
 * whenever the machine suspends — /api/cron/agent-dispatch is the backstop
 * for the gap right after a resume.
 *
 * register() runs once per server instance, before it accepts requests
 * (Next.js instrumentation hook — never runs during `next build`).
 */

const DRAIN_INTERVAL_MS = 30_000;
const SWEEP_EVERY_N_TICKS = 4; // ~every 2 minutes, alongside the drain

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { drainAgentJobs } = await import('@/lib/agent/jobs');
  const { registerAgentJobHandlers } = await import('@/lib/agent/job-handlers');
  const { sweepStalePendingInbound } = await import('@/lib/agent/whatsapp-dispatch');
  const { ensureCalendarSyncJobs } = await import('@/lib/calendar/sync');
  const { log } = await import('@/lib/log');

  registerAgentJobHandlers();

  let tick = 0;
  setInterval(() => {
    tick++;
    drainAgentJobs().catch((e) => {
      log.error('[instrumentation] agent job drain failed', {
        error: e instanceof Error ? e.message : 'unknown',
      });
    });
    if (tick % SWEEP_EVERY_N_TICKS === 0) {
      sweepStalePendingInbound().catch((e) => {
        log.error('[instrumentation] stale-inbound sweep failed', {
          error: e instanceof Error ? e.message : 'unknown',
        });
      });
      // ensureCalendarSyncJobs is a cheap safety net (syncCalendarConnection
      // self-schedules its own next run) — throttled alongside the sweep.
      ensureCalendarSyncJobs().catch((e) => {
        log.error('[instrumentation] calendar sync backstop failed', {
          error: e instanceof Error ? e.message : 'unknown',
        });
      });
    }
  }, DRAIN_INTERVAL_MS).unref();
}
