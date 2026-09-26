/**
 * Registers VOICE_JOB_KINDS.visitConfirmationMessage with the shared
 * agent_jobs queue. Idempotent — called from job-handlers.ts'
 * registerAgentJobHandlers() (item W), which every drainer already calls at
 * module load.
 */

import { registerAgentJobHandler } from '../jobs';
import { sendVoiceVisitConfirmation } from './visit-confirmation';
import { VOICE_JOB_KINDS } from './types';

let registered = false;

export function registerVoiceConfirmationJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(VOICE_JOB_KINDS.visitConfirmationMessage, sendVoiceVisitConfirmation);
}
