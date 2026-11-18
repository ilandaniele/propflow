import { log } from '@/lib/log';
import { CRON_JOB_PATHS, jobsDue } from './schedule';

export type FetchHandler<Env, Ctx> = (request: Request, env: Env, ctx: Ctx) => Promise<Response>;

const INTERNAL_ORIGIN = 'https://cron.internal';

function cronSecret(env: object): string | undefined {
  const fromEnv = (env as { CRON_SECRET?: unknown }).CRON_SECRET;
  return typeof fromEnv === 'string' && fromEnv ? fromEnv : process.env.CRON_SECRET || undefined;
}

/**
 * Runs the /api/cron/* routes due for this Cron Trigger by calling the OpenNext
 * fetch handler in-process (no network hop). Jobs run in series; a failing job
 * is logged and the rest still run.
 */
export async function runScheduled<Env extends object, Ctx>(
  cron: string,
  at: Date,
  env: Env,
  ctx: Ctx,
  fetchHandler: FetchHandler<Env, Ctx>
): Promise<void> {
  const jobs = jobsDue(cron, at);
  if (jobs.length === 0) return;

  const secret = cronSecret(env);
  if (!secret) {
    log.error('[cron/scheduled] CRON_SECRET not configured', { cron, jobs: jobs.length });
    return;
  }

  let failed = 0;
  for (const job of jobs) {
    const request = new Request(`${INTERNAL_ORIGIN}${CRON_JOB_PATHS[job]}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    });
    try {
      const response = await fetchHandler(request, env, ctx);
      await response.body?.cancel();
      if (!response.ok) {
        failed++;
        log.error('[cron/scheduled] job failed', { job, status: response.status });
      }
    } catch (e) {
      failed++;
      log.error('[cron/scheduled] job threw', { job, error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  log.info('[cron/scheduled] run complete', { cron, jobs: jobs.length, failed });
}
