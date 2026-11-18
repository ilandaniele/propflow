/**
 * Cron Trigger → job mapping (docs/07-migracion-cloudflare.md §4.4).
 *
 * wrangler.jsonc declares only two expressions ("* * * * *" and "0 * * * *");
 * this pure function decides which /api/cron/* routes each tick runs, so jobs
 * can be added or moved without touching wrangler.jsonc. All times are UTC
 * (Cron Triggers fire in UTC).
 */

export type CronJob =
  | 'agent-dispatch'
  | 'agent-sweep'
  | 'weekly-summary'
  | 'reminders'
  | 'task-reminders'
  | 'qa-export'
  | 'lead-alerts'
  | 'voice-reactivation';

export const EVERY_MINUTE = '* * * * *';
export const HOURLY = '0 * * * *';

/** The sweep (stale-inbound, calendar backstop, voice scanners) runs every N minutes. */
export const SWEEP_EVERY_MINUTES = 5;

/** Route each job maps to. Every /api/cron/* handler is POST-only. */
export const CRON_JOB_PATHS: Readonly<Record<CronJob, string>> = {
  'agent-dispatch': '/api/cron/agent-dispatch',
  'agent-sweep': '/api/cron/agent-dispatch?sweep=1',
  'weekly-summary': '/api/cron/weekly-summary',
  reminders: '/api/cron/reminders',
  'task-reminders': '/api/cron/task-reminders',
  'qa-export': '/api/cron/qa-export',
  'lead-alerts': '/api/cron/lead-alerts',
  'voice-reactivation': '/api/cron/voice-reactivation',
};

const MONDAY = 1;
const SUNDAY = 0;

/**
 * Jobs due for a Cron Trigger firing. `cron` is the expression that fired
 * (ScheduledController.cron); `at` is the scheduled time. Unknown expressions
 * return [] so a stray trigger never runs anything.
 *
 * Order matters — runScheduled executes them in series. On sweep minutes the
 * sweep runs before the drain so anything the scanners enqueue is drained in
 * the same tick.
 */
export function jobsDue(cron: string, at: Date): CronJob[] {
  const expr = cron.trim();

  if (expr === EVERY_MINUTE) {
    return at.getUTCMinutes() % SWEEP_EVERY_MINUTES === 0
      ? ['agent-sweep', 'agent-dispatch']
      : ['agent-dispatch'];
  }

  if (expr === HOURLY) {
    const hour = at.getUTCHours();
    const day = at.getUTCDay();
    const jobs: CronJob[] = [];
    if (hour === 7 && day === MONDAY) jobs.push('weekly-summary');
    if (hour === 8) jobs.push('reminders');
    if (hour === 9) jobs.push('task-reminders');
    if (hour === 12 && day === MONDAY) jobs.push('qa-export');
    if (hour === 14) jobs.push('lead-alerts');
    if (hour === 15 && day !== SUNDAY) jobs.push('voice-reactivation');
    return jobs;
  }

  return [];
}
