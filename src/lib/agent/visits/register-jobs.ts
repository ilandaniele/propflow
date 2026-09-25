/**
 * Registers the four VISIT_JOB_KINDS handlers (reminder-jobs.ts) with the
 * shared agent_jobs queue. Idempotent — called from job-handlers.ts'
 * registerAgentJobHandlers(), which every drainer (instrumentation.ts, the
 * cron backstop, the webhook route) already calls at module load.
 */

import { registerAgentJobHandler } from '../jobs';
import { VISIT_JOB_KINDS } from './job-plan';
import {
  handleVisitAdvisorReminder,
  handleVisitPostCheck,
  handleVisitReminder24h,
  handleVisitReminder2h,
} from './reminder-jobs';

let registered = false;

export function registerVisitJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(VISIT_JOB_KINDS.reminder24h, handleVisitReminder24h);
  registerAgentJobHandler(VISIT_JOB_KINDS.reminder2h, handleVisitReminder2h);
  registerAgentJobHandler(VISIT_JOB_KINDS.advisorReminder, handleVisitAdvisorReminder);
  registerAgentJobHandler(VISIT_JOB_KINDS.postCheck, handleVisitPostCheck);
}
