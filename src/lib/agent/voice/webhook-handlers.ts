/**
 * Item B: the three inbound Vapi server-events that need a live response
 * (assistant-request, tool-calls, status-update). end-of-call-report lives in
 * call-report.ts (it never needs a non-trivial response body).
 *
 * Call-context resolution follows the blueprint §3 order: (1) call.metadata's
 * agentCallId+orgId, (2) getCallByVapiId(call.id), (3) — assistant-request
 * only — a fresh row via the inbound phoneNumberId route. Never logs a
 * transcript, phone number, recording URL or tool argument (§3 "pitfalls").
 */

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { toE164 } from '@/lib/whatsapp/phone';
import { withFastDbRetry } from '@/lib/db/retry';
import { getOrCreateAgentConfig } from '../config';
import { getOrCreateSession, getSessionById } from '../session';
import { buildAgentTools } from '../tools';
import { isToolEnabledForChannel } from '../tools/channels';
import {
  buildRefusalAssistant,
  buildTimeoutFallbackAssistant,
  buildVapiAssistant,
  vapiServerUrl,
} from './assistant';
import { createCallRow, getCallById, getCallByVapiId, getVoiceChannelByPhoneNumberId, transitionCall } from './calls';
import { checkMinuteCap, getMonthlyVoiceUsage } from './usage';
import { runVoiceToolCall, VOICE_TOOL_TIMEOUT, type VoiceCompatibleTool } from './tool-adapter';
import type { AgentCallRecord } from './types';
import type { VapiAssistant, VapiServerMessage } from './vapi-types';

/** Blueprint §0.5: the whole tool-calls response is budgeted at 6.0s (Vapi cuts off ~7.5s). */
const TOOL_CALLS_BUDGET_MS = 6000;
/** Item 9: assistant-request must also answer within Vapi's window — race the whole handler and fall back if it's slow. */
const ASSISTANT_REQUEST_BUDGET_MS = 6000;
/** Blueprint §0.6: only a caller-id-shaped externalId becomes a phone; anything else ('call:<vapiCallId>') stays a session key only. */
const E164_RE = /^\+\d{7,15}$/;

async function getOrgName(orgId: string): Promise<string> {
  const rows = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return rows[0]?.name ?? '';
}

interface VapiCallLike {
  id: string;
  phoneNumberId?: string | null;
  customer?: { number?: string | null } | null;
  metadata?: Record<string, string> | null;
}

/** Blueprint §3's resolution steps 1-2 (assistant-request also does step 3 itself, since it's the only event allowed to create a new row). */
export async function resolveCallByVapiCall(call: VapiCallLike | null | undefined): Promise<AgentCallRecord | null> {
  if (!call) return null;

  const agentCallId = call.metadata?.agentCallId;
  const metaOrgId = call.metadata?.orgId;
  if (agentCallId && metaOrgId) {
    const byMeta = await withFastDbRetry(() => getCallById(metaOrgId, agentCallId), 'agent-voice-vapi:resolve');
    if (byMeta) return byMeta;
  }

  return withFastDbRetry(() => getCallByVapiId(call.id), 'agent-voice-vapi:resolve');
}

function extractToolCalls(msg: VapiServerMessage): Array<{ id: string; name: string; arguments: unknown }> {
  const list = msg.toolCallList ?? msg.toolCalls ?? [];
  return list.map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments }));
}

/**
 * `message.type === 'assistant-request'`. Unknown phoneNumberId, voice
 * disabled, or over the monthly cap → a refusal assistant (no tools, short
 * disclosure-only script) instead of an error, so the caller always hears
 * something coherent (blueprint §0.9).
 */
export async function handleAssistantRequest(msg: VapiServerMessage): Promise<{ assistant: VapiAssistant }> {
  return Promise.race([
    handleAssistantRequestInner(msg),
    new Promise<{ assistant: VapiAssistant }>((resolve) => {
      setTimeout(() => resolve({ assistant: buildTimeoutFallbackAssistant() }), ASSISTANT_REQUEST_BUDGET_MS);
    }),
  ]);
}

async function handleAssistantRequestInner(msg: VapiServerMessage): Promise<{ assistant: VapiAssistant }> {
  const call = msg.call;
  const phoneNumberId = call?.phoneNumberId ?? null;

  const channel = phoneNumberId
    ? await withFastDbRetry(() => getVoiceChannelByPhoneNumberId(phoneNumberId), 'agent-voice-vapi:assistant-request')
    : null;
  if (!channel) {
    return { assistant: buildRefusalAssistant({ persona: 'Asistente', orgName: '', reason: 'disabled' }) };
  }

  // Independent reads (both keyed by channel.orgId only) — fired together.
  const [config, orgName] = await Promise.all([
    withFastDbRetry(() => getOrCreateAgentConfig(channel.orgId), 'agent-voice-vapi:assistant-request'),
    withFastDbRetry(() => getOrgName(channel.orgId), 'agent-voice-vapi:assistant-request'),
  ]);

  if (!config.channelsEnabled.voice) {
    return { assistant: buildRefusalAssistant({ persona: config.persona, orgName, reason: 'disabled' }) };
  }

  const usage = await withFastDbRetry(
    () => getMonthlyVoiceUsage(channel.orgId, config.timezone, config.voice.maxCallMinutes),
    'agent-voice-vapi:assistant-request',
  );
  const capOk = checkMinuteCap({
    usedMinutes: usage.usedMinutes,
    inFlightCalls: usage.inFlightCalls,
    capMinutes: config.voice.monthlyMinuteCap,
    maxCallMinutes: config.voice.maxCallMinutes,
    direction: 'inbound',
  });
  if (!capOk) {
    return { assistant: buildRefusalAssistant({ persona: config.persona, orgName, reason: 'cap' }) };
  }

  const callerRaw = call?.customer?.number ?? null;
  const customerPhone = callerRaw ? toE164(callerRaw) : null;
  const externalId = customerPhone && E164_RE.test(customerPhone) ? customerPhone : `call:${call?.id ?? randomUUID()}`;

  const session = await withFastDbRetry(
    () => getOrCreateSession({ orgId: channel.orgId, channel: 'voice', externalId }),
    'agent-voice-vapi:assistant-request',
  );

  const callRow = await withFastDbRetry(
    () =>
      createCallRow({
        orgId: channel.orgId,
        direction: 'inbound',
        purpose: 'inbound',
        sessionId: session.id,
        leadId: session.leadId,
        customerPhone,
        vapiCallId: call?.id ?? null,
        phoneNumberId,
        status: 'in_progress',
      }),
    'agent-voice-vapi:assistant-request',
  );
  if (!callRow) {
    return { assistant: buildRefusalAssistant({ persona: config.persona, orgName, reason: 'disabled' }) };
  }

  const notes = session.mode === 'human' ? ['Un asesor lleva este caso: tomá el mensaje y ofrecé que te llame'] : undefined;

  const assistant = await buildVapiAssistant(
    { orgId: channel.orgId, callId: callRow.id, sessionId: session.id, leadId: session.leadId, customerPhone, purpose: 'inbound', visitId: null },
    { serverUrl: vapiServerUrl(), notes, preloaded: { config, session, orgName } },
  );

  return { assistant };
}

/**
 * `message.type === 'tool-calls'`. Always resolves — an unresolvable call or
 * missing session answers every tool call with the same spoken-safe timeout
 * text rather than erroring, since §3 requires HTTP 200 either way.
 */
export async function handleToolCalls(
  msg: VapiServerMessage,
  startedAtMs: number,
): Promise<{ results: Array<{ toolCallId: string; result: string }> }> {
  const toolCalls = extractToolCalls(msg);
  if (toolCalls.length === 0) return { results: [] };

  const callRow = await resolveCallByVapiCall(msg.call);
  const session = callRow?.sessionId
    ? await withFastDbRetry(() => getSessionById(callRow.orgId, callRow.sessionId as string), 'agent-voice-vapi:tool-calls')
    : null;

  if (!callRow || !session) {
    return { results: toolCalls.map((t) => ({ toolCallId: t.id, result: VOICE_TOOL_TIMEOUT })) };
  }

  const leadIdRef = { current: session.leadId ?? callRow.leadId };

  const toolCtx = {
    orgId: callRow.orgId,
    sessionId: session.id,
    channel: 'voice' as const,
    externalId: session.externalId,
    dryRun: false,
    leadIdRef,
    shadowMode: false,
    whatsappConversationId: null,
    voiceCallId: callRow.id,
    webSessionId: null,
    attribution: session.attribution,
  };

  const tools = buildAgentTools(toolCtx).filter((t) => isToolEnabledForChannel(t.name, 'voice')) as VoiceCompatibleTool[];

  // Sequential, not parallel: the shared 6s budget must be split across
  // however many calls Vapi batched in this one webhook delivery.
  const results: Array<{ toolCallId: string; result: string }> = [];
  for (const call of toolCalls) {
    const elapsed = Date.now() - startedAtMs;
    const remaining = TOOL_CALLS_BUDGET_MS - elapsed;
    results.push(await runVoiceToolCall(tools, call, remaining));
  }

  // A tool (e.g. register_owner_lead/update_lead_profile) may have created or
  // resolved a lead mid-call — persist it onto agent_calls so downstream
  // reporting (call-report.ts, dashboards) sees the same lead this session did.
  if (leadIdRef.current && !callRow.leadId) {
    await withFastDbRetry(
      () => transitionCall(callRow.id, [callRow.status], { leadId: leadIdRef.current }),
      'agent-voice-vapi:tool-calls:lead-id',
    );
  }

  return { results };
}

/** `message.type === 'status-update'`. Informational — no response body expected by Vapi. */
export async function handleStatusUpdate(msg: VapiServerMessage): Promise<void> {
  if (msg.status !== 'in-progress') return;

  const callRow = await resolveCallByVapiCall(msg.call);
  if (!callRow) return;

  await withFastDbRetry(
    () => transitionCall(callRow.id, ['queued', 'dialing'], { status: 'in_progress', startedAt: new Date() }),
    'agent-voice-vapi:status-update',
  );
}
