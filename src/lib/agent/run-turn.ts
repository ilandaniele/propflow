/**
 * The agent's single entry point: one inbound message in, one turn of the
 * tool-use loop, persisted history out. Channel adapters (WhatsApp webhook,
 * web widget, voice webhook — later phases) all call this; none of them
 * talk to Anthropic directly.
 *
 * Args/result types live in ./types.ts (the shared contract with the
 * WhatsApp dispatch pipeline and the inbox actions); re-exported here for
 * backward-compat imports.
 */

import { db } from '@/lib/db';
import { agentMessages } from '@/lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, AGENT_MODEL } from '@/lib/ai/client';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from './config';
import {
  getOrCreateSession,
  getSessionHistory,
  appendSessionMessage,
  setSessionMode,
  setSessionLanguage,
  recordAgentTurn,
} from './session';
import { recordAgentEvent } from './events';
import { getLead } from './lead';
import { buildAgentSystemPrompt, buildTurnContext } from './prompt';
import { buildAgentTools } from './tools';
import { detectLanguage } from './language';
import type { AgentLanguage, RunAgentTurnArgs, RunAgentTurnResult } from './types';

export type { RunAgentTurnArgs, RunAgentTurnResult } from './types';

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 2048;

/** Fallback replies (decision 10: answer in the user's language). Defaults to 'es' when no language is known. */
const TURN_CAP_REPLY: Record<AgentLanguage, string> = {
  es: 'Ya charlamos bastante por acá — un asesor va a seguir la conversación en breve.',
  en: 'We’ve covered a lot here — an advisor will take over the conversation shortly.',
  pt: 'Já conversamos bastante por aqui — um consultor vai continuar a conversa em breve.',
};
const BUDGET_EXCEEDED_REPLY: Record<AgentLanguage, string> = {
  es: 'En este momento estoy con mucha demanda. Un asesor te va a escribir en breve para seguir ayudándote.',
  en: 'We’re getting a lot of messages right now. An advisor will reach out shortly to keep helping you.',
  pt: 'Neste momento estamos com muita demanda. Um consultor vai falar com você em breve.',
};

async function isOverDailyBudget(orgId: string, dailyTokenBudget: number): Promise<boolean> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(coalesce(${agentMessages.inputTokens}, 0) + coalesce(${agentMessages.outputTokens}, 0)), 0)`,
    })
    .from(agentMessages)
    .where(and(eq(agentMessages.orgId, orgId), gte(agentMessages.createdAt, since)));

  return Number(rows[0]?.total ?? 0) >= dailyTokenBudget;
}

function extractReplyText(content: Anthropic.Beta.Messages.BetaContentBlockParam[]): string {
  const text = content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlockParam => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || 'Disculpá, ¿podrías repetir eso?';
}

export async function runAgentTurn(args: RunAgentTurnArgs): Promise<RunAgentTurnResult> {
  const dryRun = args.dryRun ?? false;
  const config = await getOrCreateAgentConfig(args.orgId);

  const session = await getOrCreateSession({
    orgId: args.orgId,
    channel: args.channel,
    externalId: args.externalId,
    whatsappConversationId: args.whatsappConversationId,
  });

  // Step 1 (blueprint §3): a live session already handed off to a human never
  // gets a model turn — the playground (dryRun) is exempt, it has its own
  // session and is never gated by mode.
  if (!dryRun && session.mode !== 'ai') {
    return {
      sessionId: session.id,
      leadId: session.leadId,
      replyText: '',
      handedOffToHuman: false,
      handoffReason: null,
      skipped: true,
      language: session.language,
      assistantMessageId: null,
    };
  }

  // Step 2: the per-session turn cap (auto-handoff, decision 8).
  if (!dryRun && config.maxAgentTurns != null && session.agentTurnCount >= config.maxAgentTurns) {
    await setSessionMode(session.id, 'human', 'Tope de turnos del agente alcanzado', 'turn_cap');
    await recordAgentEvent({
      orgId: args.orgId,
      sessionId: session.id,
      kind: 'handoff',
      data: { reason: 'turn_cap', auto: true },
    });
    log.warn('[agent] turn cap reached', { orgId: args.orgId, sessionId: session.id });
    return {
      sessionId: session.id,
      leadId: session.leadId,
      replyText: TURN_CAP_REPLY[session.language ?? 'es'],
      handedOffToHuman: true,
      handoffReason: 'turn_cap',
      skipped: false,
      language: session.language,
      assistantMessageId: null,
    };
  }

  // Step 3: the org-wide daily token budget (auto-handoff, decision 8).
  if (!dryRun && (await isOverDailyBudget(args.orgId, config.dailyTokenBudget))) {
    await setSessionMode(session.id, 'human', 'Presupuesto diario del agente agotado', 'budget');
    await recordAgentEvent({
      orgId: args.orgId,
      sessionId: session.id,
      kind: 'handoff',
      data: { reason: 'budget', auto: true },
    });
    log.warn('[agent] daily token budget exceeded', { orgId: args.orgId });
    return {
      sessionId: session.id,
      leadId: session.leadId,
      replyText: BUDGET_EXCEEDED_REPLY[session.language ?? 'es'],
      handedOffToHuman: true,
      handoffReason: 'budget',
      skipped: false,
      language: session.language,
      assistantMessageId: null,
    };
  }

  // Step 4: language detection. Never persisted or run for dryRun (pitfall: the
  // playground must never call setSessionLanguage).
  const detected = detectLanguage(args.inboundText);
  if (!dryRun && detected && detected !== session.language) {
    await setSessionLanguage(session.id, detected);
  }
  const lang: AgentLanguage = detected ?? session.language ?? 'es';

  const lead = session.leadId ? await getLead(args.orgId, session.leadId) : null;
  const history = await getSessionHistory(session.id);

  const leadIdRef = { current: session.leadId };
  const tools = buildAgentTools({
    orgId: args.orgId,
    sessionId: session.id,
    channel: args.channel,
    externalId: args.externalId,
    dryRun,
    leadIdRef,
    attribution: session.attribution,
    webSessionId: args.webSessionId ?? null,
  });

  const systemPrompt = buildAgentSystemPrompt(config);
  const turnContext = buildTurnContext(lead, new Date().toISOString(), {
    language: lang,
    attribution: session.attribution,
    humanReplies: args.humanRepliesSinceLastTurn ?? [],
    timezone: config.timezone,
    channel: args.channel,
    pageContext: args.pageContext ?? null,
    notes: args.extraContextNotes ?? [],
  });

  // Captured BEFORE appending this turn's inbound message — everything from
  // here on (the inbound message itself, tool turns, the final reply) is new
  // and gets persisted below. Capturing it after would silently drop the
  // inbound message from agent_messages.
  const historyLength = history.length;
  const newUserMessage: Anthropic.Beta.Messages.BetaMessageParam = { role: 'user', content: args.inboundText };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [...history, newUserMessage];

  const client = getAnthropicClient();
  const runner = client.beta.messages.toolRunner({
    model: AGENT_MODEL,
    max_tokens: MAX_TOKENS,
    max_iterations: MAX_ITERATIONS,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: turnContext },
    ],
    tools,
    messages,
  });

  const finalMessage = await runner.done();
  const fullMessages = runner.params.messages;
  // We never push a 'system'-role message (that's the mid-conversation-system-message
  // feature — unused here), but the SDK's type allows for one, so narrow defensively.
  const newMessages = fullMessages
    .slice(historyLength)
    .filter((m): m is Anthropic.Beta.Messages.BetaMessageParam & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant');

  // OVERRIDE (item A "Override" note): in shadow mode, the final assistant
  // reply is a draft — held for human review (see whatsapp-dispatch.ts /
  // suggestions.ts) instead of being sent. Tag it 'shadow_pending' so
  // getSessionHistory() excludes it from the next turn until it's approved
  // (optionally edited) or discarded. Never applies to dryRun (the admin
  // playground) — that has its own session and is never reviewed.
  let assistantMessageId: string | null = null;
  for (let i = 0; i < newMessages.length; i++) {
    const m = newMessages[i];
    const isLast = i === newMessages.length - 1;
    const id = await appendSessionMessage({
      orgId: args.orgId,
      sessionId: session.id,
      role: m.role,
      content: m.content,
      inputTokens: isLast ? finalMessage.usage.input_tokens : null,
      outputTokens: isLast ? finalMessage.usage.output_tokens : null,
      ...(isLast && m.role === 'assistant'
        ? { sendStatus: !dryRun && config.shadowMode ? 'shadow_pending' : 'sent' }
        : {}),
    });
    if (isLast && m.role === 'assistant') assistantMessageId = id;
  }

  if (!dryRun) await recordAgentTurn(session.id);

  const handedOffToHuman = newMessages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((b) => b.type === 'tool_use' && b.name === 'handoff_to_human'),
  );

  return {
    sessionId: session.id,
    leadId: leadIdRef.current,
    replyText: extractReplyText(finalMessage.content),
    handedOffToHuman,
    handoffReason: handedOffToHuman ? 'tool' : null,
    skipped: false,
    language: lang,
    assistantMessageId,
  };
}
