/**
 * agent_sessions / agent_messages — one conversational thread per (org,
 * channel, external_id), with the full Anthropic content-block history
 * persisted append-only so a later turn can resume with context.
 */

import { db } from '@/lib/db';
import { agentSessions, agentMessages } from '@/lib/db/schema';
import { and, eq, asc, sql, notInArray, or, isNull } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentAttribution, AgentLanguage, HandoffReason } from './types';

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
  agentTurnCount: number;
  language: AgentLanguage | null;
  attribution: AgentAttribution | null;
  handoffReason: HandoffReason | null;
  windowExpiresAt: Date | null;
  lastAgentTurnAt: Date | null;
  /** Item 6: isWindowOpen()'s fallback basis when windowExpiresAt is null. */
  lastInboundAt: Date | null;
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
    agentTurnCount: row.agentTurnCount,
    language: row.language as AgentLanguage | null,
    attribution: (row.attribution as AgentAttribution | null) ?? null,
    handoffReason: row.handoffReason as HandoffReason | null,
    windowExpiresAt: row.windowExpiresAt,
    lastAgentTurnAt: row.lastAgentTurnAt,
    lastInboundAt: row.lastInboundAt,
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

export async function getSessionById(orgId: string, sessionId: string): Promise<AgentSession | null> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.orgId, orgId)))
    .limit(1);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function getSessionByConversation(orgId: string, conversationId: string): Promise<AgentSession | null> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(
      eq(agentSessions.orgId, orgId),
      eq(agentSessions.channel, 'whatsapp'),
      eq(agentSessions.whatsappConversationId, conversationId),
    ))
    // Deterministic: (org_id, channel, whatsapp_conversation_id) isn't a unique
    // constraint, so without an ORDER BY a stray duplicate row (e.g. a bogus
    // session created by a sweeper job with a placeholder external_id) could
    // be returned nondeterministically. Oldest wins.
    .orderBy(asc(agentSessions.createdAt))
    .limit(1);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function setSessionLead(sessionId: string, leadId: string): Promise<void> {
  await db.update(agentSessions).set({ leadId, updatedAt: new Date() }).where(eq(agentSessions.id, sessionId));
}

/**
 * Back-compat: the 4th arg is optional so existing callers keep compiling.
 * Setting mode to 'ai' clears handoff_reason (a fresh AI turn is not "handed off").
 */
export async function setSessionMode(
  sessionId: string,
  mode: AgentSessionMode,
  summary?: string,
  handoffReason?: HandoffReason | null,
): Promise<void> {
  await db
    .update(agentSessions)
    .set({
      mode,
      ...(summary !== undefined ? { summary } : {}),
      ...(mode === 'ai' ? { handoffReason: null } : handoffReason !== undefined ? { handoffReason } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, sessionId));
}

const SESSION_LOCK_TTL_MS = 3 * 60 * 1000; // 3 minutes — a turn is up to 8 model iterations

/**
 * Atomically claim the session lock: succeeds only if it is unheld or expired.
 * Returns true if this call acquired it.
 */
export async function tryAcquireSessionLock(sessionId: string, ttlMs = SESSION_LOCK_TTL_MS): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(agentSessions)
    .set({ processingLockedUntil: new Date(now.getTime() + ttlMs), updatedAt: now })
    .where(and(
      eq(agentSessions.id, sessionId),
      or(isNull(agentSessions.processingLockedUntil), sql`${agentSessions.processingLockedUntil} < ${now}`),
    ))
    .returning({ id: agentSessions.id });
  return rows.length > 0;
}

export async function releaseSessionLock(sessionId: string): Promise<void> {
  await db
    .update(agentSessions)
    .set({ processingLockedUntil: null, updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}

/** Sets last_inbound_at and refreshes the 24h customer-service window from it. */
export async function touchInbound(sessionId: string, at: Date = new Date()): Promise<void> {
  await db
    .update(agentSessions)
    .set({
      lastInboundAt: at,
      windowExpiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, sessionId));
}

export async function recordAgentTurn(sessionId: string): Promise<void> {
  await db
    .update(agentSessions)
    .set({ agentTurnCount: sql`${agentSessions.agentTurnCount} + 1`, lastAgentTurnAt: new Date(), updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}

/** Used by "Devolver a IA" — resets the turn cap so the session isn't immediately re-capped. */
export async function resetTurnCount(sessionId: string): Promise<void> {
  await db
    .update(agentSessions)
    .set({ agentTurnCount: 0, updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}

export async function setSessionLanguage(sessionId: string, lang: AgentLanguage): Promise<void> {
  await db.update(agentSessions).set({ language: lang, updatedAt: new Date() }).where(eq(agentSessions.id, sessionId));
}

/** Stores attribution once, on the session's first attributed inbound. Returns true if this call wrote it. */
export async function setSessionAttributionIfEmpty(sessionId: string, a: AgentAttribution): Promise<boolean> {
  const rows = await db
    .update(agentSessions)
    .set({ attribution: a, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, sessionId), isNull(agentSessions.attribution)))
    .returning({ id: agentSessions.id });
  return rows.length > 0;
}

/**
 * Pure — no DB access. Falls back to deriving the window from `lastInboundAt`
 * (already loaded on the session row) when `windowExpiresAt` is null, instead
 * of assuming closed — cheap because it reuses a field the caller already
 * has rather than issuing a fresh query for the latest inbound message.
 */
export function isWindowOpen(
  session: Pick<AgentSession, 'windowExpiresAt' | 'lastInboundAt'>,
  now: Date = new Date(),
): boolean {
  if (session.windowExpiresAt != null) return session.windowExpiresAt.getTime() > now.getTime();
  if (session.lastInboundAt != null) return session.lastInboundAt.getTime() + 24 * 60 * 60 * 1000 > now.getTime();
  return false;
}

const HISTORY_LIMIT = 40;

/**
 * Reconstructs prior turns as BetaMessageParam[], oldest first, ready to
 * prepend to a new turn.
 *
 * OVERRIDE (Phase 2, item A "Override" note): excludes agent_messages rows
 * whose send_status is 'shadow_pending' (an unreviewed shadow-mode draft) or
 * 'shadow_discarded' (a rejected draft) — that text was never actually sent
 * to the contact, so it must never bias the model's next turn. Rows with
 * send_status NULL (pre-Phase-2 rows, and all non-assistant rows) or 'sent'
 * are included as before.
 */
export async function getSessionHistory(sessionId: string): Promise<Anthropic.Beta.Messages.BetaMessageParam[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(and(
      eq(agentMessages.sessionId, sessionId),
      or(isNull(agentMessages.sendStatus), notInArray(agentMessages.sendStatus, ['shadow_pending', 'shadow_discarded'])),
    ))
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
  /** OVERRIDE: defaults to 'sent' for assistant rows, null for user rows — see getSessionHistory(). */
  sendStatus?: 'sent' | 'shadow_pending' | 'shadow_discarded' | null;
}

/** Returns the new agent_messages row's id. */
export async function appendSessionMessage(args: PersistMessageArgs): Promise<string> {
  const sendStatus = args.sendStatus !== undefined ? args.sendStatus : args.role === 'assistant' ? 'sent' : null;
  const rows = await db
    .insert(agentMessages)
    .values({
      orgId: args.orgId,
      sessionId: args.sessionId,
      role: args.role,
      content: args.content,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      sendStatus,
    })
    .returning({ id: agentMessages.id });

  if (!rows[0]) throw new Error('[agent/session] appendSessionMessage: insert returned no id');
  return rows[0].id;
}

/**
 * OVERRIDE helper: flips an assistant agent_messages row's send_status once a
 * shadow-mode suggestion is decided. `approve` sets 'sent' — optionally
 * rewriting content to the human-edited text, since "the sent text is what
 * counts" for future turns. `discard` sets 'shadow_discarded'.
 */
/**
 * OVERRIDE (Phase 5-6, item A): follow-up and listing-alert messages
 * (src/lib/leads/followups.ts, listing-alerts.ts) are sent outside a live
 * agent turn — sendVisitMessage() writes them to whatsapp_messages but they
 * never pass through appendSessionMessage(), so without this helper the
 * agent's next turn would have no idea it already reached out. Appends the
 * text as an assistant row with send_status 'sent' so getSessionHistory()
 * includes it like any other sent reply. Item E calls this after a
 * successful send; item H is the ordering note for other builders.
 */
export async function appendSystemOutboundToHistory(a: { orgId: string; sessionId: string; text: string }): Promise<string> {
  return appendSessionMessage({
    orgId: a.orgId,
    sessionId: a.sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: a.text }],
    sendStatus: 'sent',
  });
}

export async function setAssistantMessageSendStatus(
  messageId: string,
  status: 'sent' | 'shadow_discarded',
  editedText?: string,
): Promise<void> {
  await db
    .update(agentMessages)
    .set({
      sendStatus: status,
      ...(editedText !== undefined ? { content: [{ type: 'text', text: editedText }] } : {}),
    })
    .where(and(eq(agentMessages.id, messageId), eq(agentMessages.role, 'assistant')));
}
