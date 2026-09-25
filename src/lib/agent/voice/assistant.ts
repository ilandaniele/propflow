/**
 * Builds the transient Vapi assistant for a call (inbound assistant-request,
 * or outbound before createVapiCall) — same prompt/tools pipeline as
 * runAgentTurn, minus the toolRunner loop (voice never persists agent_messages).
 */

import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_VOICE_MODEL } from '@/lib/ai/client';
import { getAppOrigin } from '@/lib/widget/origins';
import { getOrCreateAgentConfig } from '../config';
import { getSessionById } from '../session';
import { getLead } from '../lead';
import { buildAgentSystemPrompt, buildTurnContext, VOICE_RULES } from '../prompt';
import { buildAgentTools } from '../tools';
import { isToolEnabledForChannel } from '../tools/channels';
import { toVapiFunctionTools, type VoiceCompatibleTool } from './tool-adapter';
import type { VoiceCallContext } from './types';
import type { VapiAssistant } from './vapi-types';

const MODEL_MAX_TOKENS = 300;

export function vapiServerUrl(): string {
  if (process.env.VAPI_WEBHOOK_URL) return process.env.VAPI_WEBHOOK_URL;
  return `${getAppOrigin()}/api/agent/voice/vapi`;
}

/**
 * The non-editable opening disclosure (blueprint §0.9) — always the literal
 * first thing said on any call, inbound or outbound, real or refusal.
 */
export function VOICE_DISCLOSURE(persona: string, orgName: string, recording: boolean): string {
  const base = `Hola, soy ${persona}, un asistente virtual con inteligencia artificial de ${orgName}.`;
  return recording ? `${base} Esta llamada se graba.` : base;
}

export async function buildVapiAssistant(ctx: VoiceCallContext, o: { serverUrl: string; notes?: string[] }): Promise<VapiAssistant> {
  const [config, session, orgRow] = await Promise.all([
    getOrCreateAgentConfig(ctx.orgId),
    getSessionById(ctx.orgId, ctx.sessionId),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1),
  ]);
  const orgName = orgRow[0]?.name ?? '';
  const lead = ctx.leadId ? await getLead(ctx.orgId, ctx.leadId) : null;

  const toolCtx = {
    orgId: ctx.orgId,
    sessionId: ctx.sessionId,
    channel: 'voice' as const,
    externalId: session?.externalId ?? '',
    dryRun: false,
    leadIdRef: { current: ctx.leadId },
    shadowMode: false,
    whatsappConversationId: null,
    voiceCallId: ctx.callId,
    webSessionId: null,
    attribution: null,
  };

  const tools = buildAgentTools(toolCtx).filter((t) => isToolEnabledForChannel(t.name, 'voice'));

  const systemPrompt = buildAgentSystemPrompt(config);
  const turnContext = buildTurnContext(lead, new Date().toISOString(), {
    channel: 'voice',
    notes: o.notes ?? [],
    timezone: config.timezone,
  });

  const firstMessage = `${VOICE_DISCLOSURE(config.persona, orgName, config.voice.recordingEnabled)}${
    config.voice.greetingExtra ? ` ${config.voice.greetingExtra}` : ''
  }`;

  return {
    firstMessage,
    model: {
      provider: 'anthropic',
      model: AGENT_VOICE_MODEL,
      maxTokens: MODEL_MAX_TOKENS,
      messages: [{ role: 'system', content: `${systemPrompt}\n\n${VOICE_RULES}\n\n${turnContext}` }],
      // Every tool buildAgentTools() produces is a betaZodTool custom tool
      // (BetaTool-shaped) — see tool-adapter.ts's VoiceCompatibleTool note.
      tools: toVapiFunctionTools(tools as VoiceCompatibleTool[]),
    },
    voice: { provider: config.voice.voiceProvider, voiceId: config.voice.voiceId },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: config.voice.language },
    artifactPlan: { recordingEnabled: config.voice.recordingEnabled },
    maxDurationSeconds: config.voice.maxCallMinutes * 60,
    endCallFunctionEnabled: true,
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],
    server: { url: o.serverUrl },
    metadata: { orgId: ctx.orgId, agentCallId: ctx.callId },
    analysisPlan: { summaryPrompt: 'Resumí esta llamada en español, en 2-3 oraciones, para un asesor inmobiliario humano.' },
  };
}

export function buildRefusalAssistant(o: { persona: string; orgName: string; reason: 'disabled' | 'cap' }): VapiAssistant {
  const message =
    o.reason === 'cap'
      ? `${VOICE_DISCLOSURE(o.persona, o.orgName, false)} En este momento no puedo atender llamadas — escribinos por WhatsApp y te respondemos enseguida.`
      : `${VOICE_DISCLOSURE(o.persona, o.orgName, false)} Todavía no atendemos llamadas — escribinos por WhatsApp y te respondemos enseguida.`;

  return {
    firstMessage: message,
    model: {
      provider: 'anthropic',
      model: AGENT_VOICE_MODEL,
      maxTokens: 60,
      messages: [{ role: 'system', content: 'Repetí el mensaje inicial si te preguntan algo más, y despedite. No tenés herramientas disponibles.' }],
      tools: [],
    },
    voice: { provider: 'azure', voiceId: 'es-PE-CamilaNeural' },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'es' },
    maxDurationSeconds: 20,
    endCallFunctionEnabled: true,
  };
}
