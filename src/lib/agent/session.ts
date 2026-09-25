/**
 * agent_sessions / agent_messages — one conversational thread per (org,
 * channel, external_id), with the full Anthropic content-block history
 * persisted append-only so a later turn can resume with context.
 */

import { db } from '@/lib/db';
import { agentSessions, agentMessages } from '@/lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';

export type AgentChannel = 'whatsapp' | 'web' | 'voice';
export type AgentSessionMode = 'ai' | 'human' | 'paused';

export interface AgentSession {
  id: string;
  orgId: string;
  channel: AgentChannel;
  externalId: string;
  leadId: string | null;
  whatsappConversationId: string | null;
  mode: AgentSessionMode;
  summary: string | null;
}

function toSession(row: typeof agentSessions.$inferSelect): AgentSession {
  return {
    id: row.id,
    orgId: row.orgId,
    channel: row.channel as AgentChannel,
    externalId: row.externalId,
    leadId: row.leadId,
    whatsappConversationId: row.whatsappConversationId,
    mode: row.mode as AgentSessionMode,
    summary: row.summary,
  };
}

export interface GetOrCreateSessionArgs {
  orgId: string;
  channel: AgentChannel;
  externalId: string;
  whatsappConversationId?: string | null;
}

export async function getOrCreateSession(args: GetOrCreateSessionArgs): Promise<AgentSession> {
  const existing = await db
    .select()
    .from(agentSessions)
    .where(and(
      eq(agentSessions.orgId, args.orgId),
      eq(agentSessions.channel, args.channel),
      eq(agentSessions.externalId, args.externalId),
    ))
    .limit(1);

  if (existing[0]) return toSession(existing[0]);

  const inserted = await db
    .insert(agentSessions)
    .values({
      orgId: args.orgId,
      channel: args.channel,
      externalId: args.externalId,
      whatsappConversationId: args.whatsappConversationId ?? null,
    })
    .onConflictDoNothing({ target: [agentSessions.orgId, agentSessions.channel, agentSessions.externalId] })
    .returning();

  if (inserted[0]) return toSession(inserted[0]);

  // Lost a race with a concurrent first message on the same session.
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(
      eq(agentSessions.orgId, args.orgId),
      eq(agentSessions.channel, args.channel),
      eq(agentSessions.externalId, args.externalId),
    ))
    .limit(1);
  if (!rows[0]) throw new Error('[agent/session] failed to get or create session');
  return toSession(rows[0]);
}

export async function setSessionLead(sessionId: string, leadId: string): Promise<void> {
  await db.update(agentSessions).set({ leadId, updatedAt: new Date() }).where(eq(agentSessions.id, sessionId));
}

export async function setSessionMode(sessionId: string, mode: AgentSessionMode, summary?: string): Promise<void> {
  await db
    .update(agentSessions)
    .set({ mode, ...(summary !== undefined ? { summary } : {}), updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}

const HISTORY_LIMIT = 40;

/** Reconstructs prior turns as BetaMessageParam[], oldest first, ready to prepend to a new turn. */
export async function getSessionHistory(sessionId: string): Promise<Anthropic.Beta.Messages.BetaMessageParam[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.createdAt))
    .limit(HISTORY_LIMIT);

  return rows.map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as Anthropic.Beta.Messages.BetaContentBlockParam[],
  }));
}

export interface PersistMessageArgs {
  orgId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: Anthropic.Beta.Messages.BetaContentBlockParam[] | string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export async function appendSessionMessage(args: PersistMessageArgs): Promise<void> {
  await db.insert(agentMessages).values({
    orgId: args.orgId,
    sessionId: args.sessionId,
    role: args.role,
    content: args.content,
    inputTokens: args.inputTokens ?? null,
    outputTokens: args.outputTokens ?? null,
  });
}
