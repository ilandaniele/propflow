/**
 * Durable outbound-call pipeline (blueprint §0.8): queueOutboundCall inserts
 * the agent_calls row + enqueues the agent_jobs dialer job; runOutboundCallJob
 * is that job's handler, re-running the compliance gate right before dialing.
 */

import { log } from '@/lib/log';
import { toE164 } from '@/lib/whatsapp/phone';
import { getOrCreateAgentConfig } from '../config';
import { getLead } from '../lead';
import { getVisit } from '../visits/service';
import { nextWindowStart } from '../config-schema';
import { enqueueJob } from '../jobs';
import { getOrCreateSession } from '../session';
import { formatSlotLabel } from '../visits/slots';
import { createCallRow, getCallById, getOrgVoiceChannel, transitionCall } from './calls';
import { evaluateOutboundCall } from './compliance';
import { buildVapiAssistant, vapiServerUrl } from './assistant';
import { createVapiCall, VapiApiError } from './vapi-client';
import { VOICE_JOB_KINDS, type AgentCallRecord, type CallPurpose } from './types';

const E164_RE = /^\+\d{7,15}$/;

/** Normalizes to E.164 and validates shape; returns null for anything that can't be a dialable number. */
function normalizeCallPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = toE164(phone);
  return E164_RE.test(normalized) ? normalized : null;
}

export interface QueueOutboundCallArgs {
  orgId: string;
  leadId: string;
  purpose: Exclude<CallPurpose, 'inbound'>;
  visitId?: string | null;
  dedupeKey: string;
  runAt?: Date;
}

/**
 * Inserts a 'queued' agent_calls row and enqueues its dialer job.
 * Returns null on a dedupe-key conflict (already queued/handled) — the
 * caller (scanners.ts) doesn't count that as a new call.
 */
export async function queueOutboundCall(a: QueueOutboundCallArgs): Promise<string | null> {
  // Phones live on crm_leads, not on the call row's own inputs — looked up
  // once here so the row (and every later compliance check) has a stable
  // customer_phone even if the lead's phone changes afterwards.
  const lead = await getLead(a.orgId, a.leadId);

  const row = await createCallRow({
    orgId: a.orgId,
    direction: 'outbound',
    purpose: a.purpose,
    leadId: a.leadId,
    visitId: a.visitId ?? null,
    customerPhone: normalizeCallPhone(lead?.phone),
    dedupeKey: a.dedupeKey,
    status: 'queued',
  });
  if (!row) return null;

  await enqueueJob({ orgId: a.orgId, kind: VOICE_JOB_KINDS.outboundCall, payload: { callId: row.id }, runAt: a.runAt });
  return row.id;
}

async function buildPurposeNotes(orgId: string, call: AgentCallRecord, timezone: string): Promise<string[]> {
  if (call.purpose === 'speed_to_lead') {
    return ['Llamás porque dejó sus datos; calificá y ofrecé visita.'];
  }
  if (call.purpose === 'visit_confirmation' && call.visitId) {
    const visit = await getVisit(orgId, call.visitId);
    if (visit) {
      const label = formatSlotLabel(visit.startsAt, timezone);
      return [
        `Llamás para confirmar la visita a ${visit.listingTitle ?? 'la propiedad'} el ${label} (visitId ${visit.id}); usá confirm_my_visit/cancel_visit.`,
      ];
    }
  }
  if (call.purpose === 'reactivation') {
    return ['Seguimiento; preguntá si sigue buscando.'];
  }
  return [];
}

/**
 * agent_jobs handler for VOICE_JOB_KINDS.outboundCall. Re-checks compliance
 * right before dialing (queue-time checks can go stale — a lead may opt out,
 * the monthly cap may fill up, etc. between queueing and draining).
 */
export async function runOutboundCallJob(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const callId = payload.callId as string | undefined;
  if (!callId) {
    log.error('[voice/outbound] runOutboundCallJob: payload missing callId');
    return;
  }

  const call = await getCallById(orgId, callId);
  if (!call || call.status !== 'queued') return; // already dialing/ended/etc. — no-op

  // Re-normalize before compliance: a phone can only have gone stale/malformed
  // since queue time (lead edits, backfills, etc.); never re-run the compliance
  // gate against an un-dialable number.
  const normalizedPhone = normalizeCallPhone(call.customerPhone);
  if (!normalizedPhone) {
    await transitionCall(call.id, ['queued'], { status: 'blocked', blockReason: 'no_number' });
    return;
  }

  const decision = await evaluateOutboundCall({ ...call, customerPhone: normalizedPhone });

  if (decision.action === 'defer') {
    const config = await getOrCreateAgentConfig(orgId);
    const nextStart = nextWindowStart(config.voice.callWindow, new Date(), config.timezone);
    await enqueueJob({ orgId, kind: VOICE_JOB_KINDS.outboundCall, payload: { callId }, runAt: nextStart });
    return;
  }

  if (decision.action === 'block') {
    const status = decision.reason === 'stale' ? 'skipped' : 'blocked';
    await transitionCall(call.id, ['queued'], { status, blockReason: decision.reason });
    return;
  }

  const dialing = await transitionCall(call.id, ['queued'], { status: 'dialing' });
  if (!dialing) return; // lost a race with a concurrent drain of the same job

  try {
    const voiceChannel = await getOrgVoiceChannel(orgId);
    if (!voiceChannel) {
      await transitionCall(call.id, ['dialing'], { status: 'failed', blockReason: 'no_number' });
      return;
    }

    const session = await getOrCreateSession({ orgId, channel: 'voice', externalId: normalizedPhone });
    await transitionCall(call.id, ['dialing'], { sessionId: session.id });

    const config = await getOrCreateAgentConfig(orgId);
    const notes = await buildPurposeNotes(orgId, call, config.timezone);

    const assistant = await buildVapiAssistant(
      { orgId, callId: call.id, sessionId: session.id, leadId: call.leadId, customerPhone: normalizedPhone, purpose: call.purpose, visitId: call.visitId },
      { serverUrl: vapiServerUrl(), notes },
    );

    try {
      const result = await createVapiCall({
        phoneNumberId: voiceChannel.phoneNumberId,
        customerNumber: normalizedPhone,
        assistant,
        metadata: { orgId, agentCallId: call.id },
      });
      await transitionCall(call.id, ['dialing'], { status: 'in_progress', vapiCallId: result.id });
    } catch (err) {
      if (err instanceof VapiApiError && err.status === 0) {
        // Network failure or timeout AFTER we asked Vapi to dial — we can't tell
        // whether the call actually went out, so this is terminal: never retry
        // (retrying here risks double-dialing the lead).
        await transitionCall(call.id, ['dialing'], { status: 'failed', blockReason: 'dial_uncertain' });
        return;
      }
      if (err instanceof VapiApiError && err.status !== 429 && err.status < 500) {
        // Non-retryable 4xx (bad request, auth, etc.) — terminal.
        await transitionCall(call.id, ['dialing'], { status: 'failed', blockReason: `vapi_error_${err.status}` });
        return;
      }
      // Explicit 429 / 5xx — back to queued so agent_jobs' retry/backoff redials it.
      await transitionCall(call.id, ['dialing'], { status: 'queued' });
      throw err;
    }
  } catch (err) {
    // Anything else thrown while preparing the call (voice-channel/session/config
    // lookups, assistant build) is treated as retryable — back to queued so
    // agent_jobs redials it. A VapiApiError rethrown from the inner block above
    // has already had its status transition decided; don't double-transition it.
    if (!(err instanceof VapiApiError)) {
      await transitionCall(call.id, ['dialing'], { status: 'queued' });
    }
    throw err;
  }
}
