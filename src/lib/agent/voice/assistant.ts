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
import { getOrCreateAgentConfig, type AgentConfig } from '../config';
import { getSessionById, type AgentSession } from '../session';
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

export interface BuildVapiAssistantOptions {
  serverUrl: string;
  notes?: string[];
  /**
   * Callers that already loaded these rows for their own logic (e.g.
   * webhook-handlers.ts's assistant-request handler) can pass them through
   * instead of paying for a second round-trip here.
   */
  preloaded?: { config?: AgentConfig; session?: AgentSession | null; orgName?: string };
}

export async function buildVapiAssistant(ctx: VoiceCallContext, o: BuildVapiAssistantOptions): Promise<VapiAssistant> {
  const needsConfig = !o.preloaded?.config;
  const needsSession = o.preloaded?.session === undefined;
  const needsOrgName = o.preloaded?.orgName === undefined;

  const [config, session, orgRow] = await Promise.all([
    needsConfig ? getOrCreateAgentConfig(ctx.orgId) : Promise.resolve(o.preloaded!.config!),
    needsSession ? getSessionById(ctx.orgId, ctx.sessionId) : Promise.resolve(o.preloaded!.session!),
    needsOrgName
      ? db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1)
      : Promise.resolve(null),
  ]);
  const orgName = needsOrgName ? (orgRow?.[0]?.name ?? '') : o.preloaded!.orgName!;
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
    server: { url: o.serverUrl, secret: process.env.VAPI_WEBHOOK_SECRET },
    metadata: { orgId: ctx.orgId, agentCallId: ctx.callId },
    analysisPlan: { summaryPrompt: 'Resumí esta llamada en español, en 2-3 oraciones, para un asesor inmobiliario humano.' },
  };
}

/**
 * Used when handleAssistantRequest can't finish within its budget (item 9) —
 * unlike buildRefusalAssistant, this never depends on org-specific data
 * having loaded yet, since the whole point is that it may not have.
 */
export function buildTimeoutFallbackAssistant(): VapiAssistant {
  return {
    firstMessage: 'Estamos con demoras técnicas en este momento — te transfiero con un asesor humano.',
    model: {
      provider: 'anthropic',
      model: AGENT_VOICE_MODEL,
      maxTokens: 60,
      messages: [{ role: 'system', content: 'Repetí el mensaje inicial si te preguntan algo más y despedite. No tenés herramientas disponibles.' }],
      tools: [],
    },
    voice: { provider: 'azure', voiceId: 'es-PE-CamilaNeural' },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'es' },
    maxDurationSeconds: 20,
    endCallFunctionEnabled: true,
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
