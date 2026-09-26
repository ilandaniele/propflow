/**
 * Registers the two CALENDAR_JOB_KINDS handlers (push.ts, sync.ts) with the
 * shared agent_jobs queue. Idempotent — called from job-handlers.ts'
 * registerAgentJobHandlers() (item H), which every drainer (instrumentation.ts,
 * the cron backstop, the webhook route) already calls at module load.
 */

import { registerAgentJobHandler } from '@/lib/agent/jobs';
import { pushVisitToCalendar } from './push';
import { syncCalendarConnection } from './sync';
import { CALENDAR_JOB_KINDS } from './types';

let registered = false;

export function registerCalendarJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(CALENDAR_JOB_KINDS.push, pushVisitToCalendar);
  registerAgentJobHandler(CALENDAR_JOB_KINDS.sync, syncCalendarConnection);
}
