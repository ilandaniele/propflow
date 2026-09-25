/**
 * Registers the lead.followup job handler with the shared agent_jobs queue.
 * Idempotent — called from job-handlers.ts' registerAgentJobHandlers(),
 * which every drainer (instrumentation.ts, the cron backstop, the webhook
 * route) already calls at module load. Same pattern as
 * src/lib/agent/visits/register-jobs.ts.
 */

import { registerAgentJobHandler } from '@/lib/agent/jobs';
import { runFollowupJob } from './followups';
import { LEAD_JOB_KINDS } from './types';

let registered = false;

export function registerLeadJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(LEAD_JOB_KINDS.followup, runFollowupJob);
}
