/**
 * agent_suggestions — shadow mode's review queue. The turn runs for real
 * (tools write, history persists) but the reply waits here for a human to
 * approve (optionally edited) or discard before it ever reaches WhatsApp.
 */

import { db } from '@/lib/db';
import { agentSuggestions } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { recordAgentEvent } from './events';
import { setAssistantMessageSendStatus } from './session';
import { sendWhatsAppText, type SendOutcome } from './outbound';

export interface CreateSuggestionArgs {
  orgId: string;
  sessionId: string;
  conversationId: string | null;
  body: string;
  /**
   * OVERRIDE (item A "Override" note): the agent_messages row this
   * suggestion drafted (RunAgentTurnResult.assistantMessageId). Lets
   * approve/discard flip that row's send_status so an unsent or rejected
   * draft never leaks into the LLM history — see session.ts's
   * getSessionHistory().
   */
  agentMessageId?: string | null;
}

/** Supersedes any existing pending suggestion for the session, then inserts the new one. Returns its id. */
export async function createSuggestion(args: CreateSuggestionArgs): Promise<string> {
  return db.transaction(async (tx) => {
    await tx
      .update(agentSuggestions)
      .set({ status: 'superseded', decidedAt: new Date() })
      .where(and(eq(agentSuggestions.sessionId, args.sessionId), eq(agentSuggestions.status, 'pending')));

    const rows = await tx
      .insert(agentSuggestions)
      .values({
        orgId: args.orgId,
        sessionId: args.sessionId,
        whatsappConversationId: args.conversationId,
        agentMessageId: args.agentMessageId ?? null,
        body: args.body,
      })
      .returning({ id: agentSuggestions.id });

    if (!rows[0]) throw new Error('[agent/suggestions] createSuggestion: insert returned no id');
    return rows[0].id;
  });
}

export interface PendingSuggestion {
  id: string;
  body: string;
  createdAt: Date;
}

export async function getPendingSuggestion(orgId: string, sessionId: string): Promise<PendingSuggestion | null> {
  const rows = await db
    .select({ id: agentSuggestions.id, body: agentSuggestions.body, createdAt: agentSuggestions.createdAt })
    .from(agentSuggestions)
    .where(and(
      eq(agentSuggestions.orgId, orgId),
      eq(agentSuggestions.sessionId, sessionId),
      eq(agentSuggestions.status, 'pending'),
    ))
    .orderBy(desc(agentSuggestions.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

export interface ApproveSuggestionArgs {
  orgId: string;
  suggestionId: string;
  profileId: string;
  editedBody?: string;
}

/**
 * Approves a pending suggestion and sends it (as-is, or with the human's
 * edit). The `WHERE status='pending'` on the claiming update means a double
 * click can never send twice.
 */
export async function approveSuggestion(args: ApproveSuggestionArgs): Promise<SendOutcome> {
  const claimed = await db
    .update(agentSuggestions)
    .set({ status: 'sent', decidedBy: args.profileId, decidedAt: new Date() })
    .where(and(
      eq(agentSuggestions.id, args.suggestionId),
      eq(agentSuggestions.orgId, args.orgId),
      eq(agentSuggestions.status, 'pending'),
    ))
    .returning();

  const suggestion = claimed[0];
  if (!suggestion) return { ok: false, code: 'NOT_FOUND' };
  if (!suggestion.whatsappConversationId) return { ok: false, code: 'NOT_FOUND' };

  const body = args.editedBody ?? suggestion.body;

  const outcome = await sendWhatsAppText({
    orgId: args.orgId,
    conversationId: suggestion.whatsappConversationId,
    body,
    senderKind: 'human',
    sentByProfileId: args.profileId,
  });

  if (suggestion.agentMessageId) {
    // "The human approved it as-is" → no edit, the draft text stands as sent.
    // "The human edited it" → the sent text is what counts for future turns.
    await setAssistantMessageSendStatus(
      suggestion.agentMessageId,
      'sent',
      args.editedBody !== undefined ? args.editedBody : undefined,
    );
  }

  if (outcome.ok) {
    await db
      .update(agentSuggestions)
      .set({ sentMessageId: outcome.messageId })
      .where(eq(agentSuggestions.id, suggestion.id));
  }

  await recordAgentEvent({
    orgId: args.orgId,
    sessionId: suggestion.sessionId,
    kind: 'suggestion_sent',
    data: { suggestionId: suggestion.id, edited: args.editedBody !== undefined, ok: outcome.ok },
    actorProfileId: args.profileId,
  });

  return outcome;
}

export interface DiscardSuggestionArgs {
  orgId: string;
  suggestionId: string;
  profileId: string;
}

export async function discardSuggestion(args: DiscardSuggestionArgs): Promise<void> {
  const claimed = await db
    .update(agentSuggestions)
    .set({ status: 'discarded', decidedBy: args.profileId, decidedAt: new Date() })
    .where(and(
      eq(agentSuggestions.id, args.suggestionId),
      eq(agentSuggestions.orgId, args.orgId),
      eq(agentSuggestions.status, 'pending'),
    ))
    .returning();

  const suggestion = claimed[0];
  if (!suggestion) return;

  if (suggestion.agentMessageId) {
    await setAssistantMessageSendStatus(suggestion.agentMessageId, 'shadow_discarded');
  }

  await recordAgentEvent({
    orgId: args.orgId,
    sessionId: suggestion.sessionId,
    kind: 'suggestion_discarded',
    data: { suggestionId: suggestion.id },
    actorProfileId: args.profileId,
  });
}
