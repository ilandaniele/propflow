/**
 * Registers every agent_jobs handler (src/lib/agent/jobs.ts). Must run
 * before drainAgentJobs is ever called — instrumentation.ts, the cron
 * backstop route, and the webhook route (module load) all call this.
 * Idempotent: repeated calls are no-ops after the first.
 */

import { registerAgentJobHandler } from './jobs';
import { AGENT_WHATSAPP_TURN_JOB, processWhatsAppAgentTurn, type WhatsAppAgentTurnPayload } from './whatsapp-dispatch';
import { registerVisitJobHandlers } from './visits/register-jobs';
import { registerVisitButtonReplyHandler } from './visits/button-reply';

let registered = false;

export function registerAgentJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerAgentJobHandler(AGENT_WHATSAPP_TURN_JOB, (payload, orgId) =>
    processWhatsAppAgentTurn(payload as unknown as WhatsAppAgentTurnPayload, orgId));

  // Phase 3-4 item C: registered here (rather than in the webhook route,
  // which is out of scope this phase) because every drainer that calls
  // registerAgentJobHandlers() — instrumentation.ts, the cron backstop, and
  // the webhook route's module load — needs the visit job handlers too, and
  // the webhook route is also the only place that dispatches button replies.
  registerVisitJobHandlers();
  registerVisitButtonReplyHandler();
}
