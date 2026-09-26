/**
 * Registers every agent_jobs handler (src/lib/agent/jobs.ts). Must run
 * before drainAgentJobs is ever called — instrumentation.ts, the cron
 * backstop route, and the webhook route (module load) all call this.
 * Idempotent: repeated calls are no-ops after the first.
 */

import { registerAgentJobHandler } from './jobs';
import { AGENT_WHATSAPP_TURN_JOB, processWhatsAppAgentTurn, type WhatsAppAgentTurnPayload } from './whatsapp-dispatch';

let registered = false;

export function registerAgentJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(AGENT_WHATSAPP_TURN_JOB, (payload, orgId) =>
    processWhatsAppAgentTurn(payload as unknown as WhatsAppAgentTurnPayload, orgId));
}
