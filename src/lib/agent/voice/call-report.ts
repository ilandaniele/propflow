/**
 * `message.type === 'end-of-call-report'` — the only writer of the call's
 * final transcript/recording/summary/cost. Idempotent: an already-'ended'
 * row is a no-op (Vapi is known to redeliver this event).
 */

import { db } from '@/lib/db';
import { agentSessions, crmLeads } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { withFastDbRetry } from '@/lib/db/retry';
import { recordAgentEvent } from '../events';
import { getLead } from '../lead';
import { resolveCallByVapiCall } from './webhook-handlers';
import { transitionCall } from './calls';
import type { CallOutcome } from './types';
import type { VapiServerMessage } from './vapi-types';

const TRANSCRIPT_MAX_CHARS = 100_000;
const SUMMARY_MAX_CHARS = 2000;

/**
 * Pure. Order matters — a specific reason string wins over the duration
 * heuristic (blueprint §4): customer-busy→busy, no-answer→no_answer,
 * voicemail→voicemail, error*→failed, <5s→abandoned, else answered.
 */
export function mapEndedReason(r: string | null, durationSeconds: number | null): CallOutcome {
  const reason = (r ?? '').toLowerCase();
  if (reason.includes('busy')) return 'busy';
  if (reason.includes('no-answer') || reason.includes('no_answer')) return 'no_answer';
  if (reason.includes('voicemail')) return 'voicemail';
  if (reason.includes('error')) return 'failed';
  if (durationSeconds != null && durationSeconds < 5) return 'abandoned';
  return 'answered';
}

async function recordVoiceCallEvent(
  orgId: string,
  sessionId: string,
  data: { callId: string; purpose: string; outcome: CallOutcome | null; durationSeconds: number | null },
): Promise<void> {
  await recordAgentEvent({ orgId, sessionId, kind: 'voice_call', data });
}

interface VapiCallExtra {
  startedAt?: string | null;
  endedAt?: string | null;
  cost?: number | null;
}

interface VapiEndOfCallExtra {
  artifact?: { recordingUrl?: string | null; transcript?: string | null } | null;
  analysis?: { summary?: string | null } | null;
  costBreakdown?: Record<string, unknown> | null;
}

export async function handleEndOfCallReport(msg: VapiServerMessage): Promise<void> {
  const callRow = await resolveCallByVapiCall(msg.call);
  if (!callRow) return; // nothing to attach this report to (shouldn't happen outside tests/races)
  if (callRow.status === 'ended') return; // idempotent: Vapi is known to redeliver this event

  const callExtra = (msg.call ?? {}) as VapiCallExtra;
  const extra = msg as VapiServerMessage & VapiEndOfCallExtra;

  const recordingUrl = msg.recordingUrl ?? extra.artifact?.recordingUrl ?? null;
  const transcriptRaw = msg.transcript ?? extra.artifact?.transcript ?? null;
  const summaryRaw = msg.summary ?? extra.analysis?.summary ?? null;
  const cost = msg.cost ?? callExtra.cost ?? null;

  const startedAt = callExtra.startedAt ? new Date(callExtra.startedAt) : null;
  const endedAt = callExtra.endedAt ? new Date(callExtra.endedAt) : new Date();
  let durationSeconds = msg.durationSeconds ?? null;
  if (durationSeconds == null && startedAt) {
    durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  }

  const outcome = mapEndedReason(msg.endedReason ?? null, durationSeconds);
  const transcript = transcriptRaw ? transcriptRaw.slice(0, TRANSCRIPT_MAX_CHARS) : null;
  const summary = summaryRaw ? summaryRaw.slice(0, SUMMARY_MAX_CHARS) : null;

  const updated = await withFastDbRetry(
    () =>
      transitionCall(callRow.id, ['queued', 'dialing', 'in_progress'], {
        status: 'ended',
        endedAt,
        ...(startedAt ? { startedAt } : {}),
        durationSeconds,
        endedReason: msg.endedReason ?? null,
        outcome,
        transcript,
        recordingUrl,
        summary,
        costUsd: cost != null ? cost.toFixed(4) : null,
        costBreakdown: extra.costBreakdown ?? null,
      }),
    'agent-voice-vapi:end-of-call-report',
  );
  if (!updated) return; // lost a redelivery race — the other delivery already finalized this row

  if (callRow.sessionId) {
    await withFastDbRetry(
      () => db.update(agentSessions).set({ summary }).where(and(eq(agentSessions.id, callRow.sessionId as string), eq(agentSessions.orgId, callRow.orgId))),
      'agent-voice-vapi:end-of-call-report:session-summary',
    );
    await recordVoiceCallEvent(callRow.orgId, callRow.sessionId, {
      callId: callRow.id,
      purpose: callRow.purpose,
      outcome,
      durationSeconds,
    });
  }

  // Blueprint §4: answered + >=15s + still 'new' → 'contacted'. Never touches any other stage.
  if (outcome === 'answered' && (durationSeconds ?? 0) >= 15 && callRow.leadId) {
    const lead = await withFastDbRetry(() => getLead(callRow.orgId, callRow.leadId as string), 'agent-voice-vapi:end-of-call-report:lead');
    if (lead && lead.stage === 'new') {
      await withFastDbRetry(
        () =>
          db
            .update(crmLeads)
            .set({ stage: 'contacted' })
            .where(and(eq(crmLeads.id, callRow.leadId as string), eq(crmLeads.orgId, callRow.orgId), eq(crmLeads.stage, 'new'))),
        'agent-voice-vapi:end-of-call-report:lead-stage',
      );
    }
  }
}
