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

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { drainAgentJobs } = await import('@/lib/agent/jobs');
  const { log } = await import('@/lib/log');

  setInterval(() => {
    drainAgentJobs().catch((e) => {
      log.error('[instrumentation] agent job drain failed', {
        error: e instanceof Error ? e.message : 'unknown',
      });
    });
  }, DRAIN_INTERVAL_MS).unref();
}
