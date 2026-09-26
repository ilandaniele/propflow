/**
 * Registers VOICE_JOB_KINDS.outboundCall with the shared agent_jobs queue.
 * Idempotent — called from job-handlers.ts' registerAgentJobHandlers(),
 * which every drainer (instrumentation.ts, the cron backstop, the voice
 * webhook route) already calls at module load. Mirrors
 * visits/register-jobs.ts's pattern.
 */

import { registerAgentJobHandler } from '../jobs';
import { runOutboundCallJob } from './outbound';
import { VOICE_JOB_KINDS } from './types';

let registered = false;

export function registerVoiceOutboundJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(VOICE_JOB_KINDS.outboundCall, runOutboundCallJob);
}
