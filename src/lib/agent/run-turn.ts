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
import { getOrCreateSession, getSessionHistory, appendSessionMessage } from './session';
import { getLead } from './lead';
import { buildAgentSystemPrompt, buildTurnContext } from './prompt';
import { buildAgentTools } from './tools';
import type { RunAgentTurnArgs, RunAgentTurnResult } from './types';

export type { RunAgentTurnArgs, RunAgentTurnResult } from './types';

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 2048;
const BUDGET_EXCEEDED_REPLY =
  'En este momento estoy con mucha demanda. Un asesor te va a escribir en breve para seguir ayudándote.';

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

  if (!dryRun && (await isOverDailyBudget(args.orgId, config.dailyTokenBudget))) {
    log.warn('[agent] daily token budget exceeded', { orgId: args.orgId });
    return {
      sessionId: session.id,
      leadId: session.leadId,
      replyText: BUDGET_EXCEEDED_REPLY,
      handedOffToHuman: false,
      handoffReason: null,
      skipped: false,
      language: null,
      assistantMessageId: null,
    };
  }

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
  });

  const systemPrompt = buildAgentSystemPrompt(config);
  const turnContext = buildTurnContext(lead, new Date().toISOString());

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

  return {
    sessionId: session.id,
    leadId: leadIdRef.current,
    replyText: extractReplyText(finalMessage.content),
    handedOffToHuman: newMessages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use' && b.name === 'handoff_to_human'),
    ),
    handoffReason: newMessages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use' && b.name === 'handoff_to_human'),
    )
      ? 'tool'
      : null,
    skipped: false,
    language: null,
    assistantMessageId,
  };
}
