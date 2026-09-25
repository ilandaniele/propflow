/**
 * WhatsApp DB helpers — upsert conversation, insert message, tenant lookup by phone.
 * Uses db directly (called from webhook handler, which runs outside user context).
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import {
  whatsappConversations,
  whatsappMessages,
  orgChannels,
  tenants,
} from '@/lib/db/schema';
import { eq, and, sql, asc, gt, lt, isNotNull, inArray } from 'drizzle-orm';
import { log } from '@/lib/log';

export interface UpsertConversationArgs {
  orgId: string;
  externalPhone: string;    // E.164
  tenantId?: string | null;
}

export interface InsertMessageArgs {
  orgId: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  providerMessageId?: string | null;
  body?: string | null;       // PII — never log
  attachmentPath?: string | null;
  attachmentKind?: 'image' | 'document' | 'audio' | 'video' | null;
  classification?: string | null;
  status?: string;
  meta?: Record<string, unknown>;
  agentStatus?: 'pending' | 'processing' | 'processed' | 'skipped' | null;
  senderKind?: 'contact' | 'agent' | 'human' | 'system' | null;
  sentByProfileId?: string | null;
}

/**
 * Upsert a whatsapp_conversations row, keyed by (org_id, external_phone).
 * Returns the conversation id.
 */
export async function upsertConversation({
  orgId,
  externalPhone,
  tenantId,
}: UpsertConversationArgs): Promise<string> {
  const rows = await db
    .insert(whatsappConversations)
    .values({
      orgId,
      externalPhone,
      tenantId: tenantId ?? null,
      lastMessageAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [whatsappConversations.orgId, whatsappConversations.externalPhone],
      set: {
        lastMessageAt: new Date(),
        tenantId: tenantId ?? null,
      },
    })
    .returning({ id: whatsappConversations.id });

  if (!rows[0]?.id) {
    log.error('[whatsapp:db] upsertConversation failed', { orgId });
    throw new Error('Failed to upsert conversation');
  }

  return rows[0].id;
}

/**
 * Increment unread_count_admin on a conversation using a raw SQL update.
 */
export async function incrementUnread(
  conversationId: string
): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({
      unreadCountAdmin: sql`${whatsappConversations.unreadCountAdmin} + 1`,
    })
    .where(eq(whatsappConversations.id, conversationId));
}

/**
 * Insert a whatsapp_messages row.
 * Ignores unique-constraint conflicts (idempotent on provider_message_id).
 * Returns the new message id, or null if it was a duplicate.
 */
export async function insertMessage(args: InsertMessageArgs): Promise<string | null> {
  const { orgId, conversationId, direction, providerMessageId, body,
          attachmentPath, attachmentKind, classification, status = 'received', meta = {},
          agentStatus, senderKind, sentByProfileId } = args;

  try {
    const rows = await db
      .insert(whatsappMessages)
      .values({
        orgId,
        conversationId,
        direction: direction as 'inbound' | 'outbound',
        providerMessageId: providerMessageId ?? null,
        body: body ?? null,     // PII — stored but never logged
        attachmentPath: attachmentPath ?? null,
        attachmentKind: attachmentKind ?? null,
        classification: classification ?? null,
        status,
        meta,
        agentStatus: agentStatus ?? null,
        senderKind: senderKind ?? null,
        sentByProfileId: sentByProfileId ?? null,
      })
      // Plain unique index (migration 0005), not the old deferrable constraint —
      // matches the arbiter Postgres requires for ON CONFLICT.
      .onConflictDoNothing({ target: [whatsappMessages.orgId, whatsappMessages.providerMessageId] })
      .returning({ id: whatsappMessages.id });

    if (!rows[0]?.id) {
      log.info('[whatsapp:db] duplicate message ignored', { orgId, providerMessageId: providerMessageId?.slice(0, 8) });
      return null;
    }

    return rows[0].id;
  } catch (err) {
    log.error('[whatsapp:db] insertMessage failed', { orgId, err: (err as Error).message });
    throw new Error('Failed to insert message');
  }
}

/**
 * Find a tenant by their whatsapp_phone within the org.
 * Returns tenant id and profile_id, or null if not found.
 */
export async function findTenantByPhone(
  orgId: string,
  phone: string   // E.164 — PII, do not log
): Promise<{ id: string; profile_id: string | null; preferred_language: string } | null> {
  const rows = await db
    .select({
      id: tenants.id,
      profileId: tenants.profileId,
      preferredLanguage: tenants.preferredLanguage,
    })
    .from(tenants)
    .where(and(
      eq(tenants.orgId, orgId),
      eq(tenants.whatsappPhone, phone),
    ))
    .limit(1);

  if (!rows[0]) return null;

  return {
    id: rows[0].id,
    profile_id: rows[0].profileId ?? null,
    preferred_language: rows[0].preferredLanguage ?? 'es',
  };
}

/**
 * Resolve the organization that owns a WhatsApp phone_number_id.
 * Returns null if no org_channels row is configured for it yet — the caller
 * should log and skip (return 200) rather than guessing an org.
 */
export async function findOrgIdByWhatsAppPhoneNumberId(
  phoneNumberId: string
): Promise<string | null> {
  const rows = await db
    .select({ orgId: orgChannels.orgId })
    .from(orgChannels)
    .where(and(eq(orgChannels.channel, 'whatsapp'), eq(orgChannels.externalId, phoneNumberId)))
    .limit(1);

  return rows[0]?.orgId ?? null;
}

/**
 * Update a message's delivery status from a Meta `statuses` webhook entry.
 * No-op if the provider_message_id is not found (message may not be persisted yet).
 */
export async function updateMessageStatusByProviderId(
  orgId: string,
  providerMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
): Promise<void> {
  await db
    .update(whatsappMessages)
    .set({ status })
    .where(and(
      eq(whatsappMessages.orgId, orgId),
      eq(whatsappMessages.providerMessageId, providerMessageId),
    ));
}

/**
 * Atomically claim every 'pending' inbound message for a conversation
 * (pending → processing). This IS the turn's debounce: a single turn picks
 * up every message queued since the last claim. Returned oldest first.
 */
export async function claimPendingInbound(
  orgId: string,
  conversationId: string
): Promise<Array<{ id: string; body: string | null; attachmentKind: string | null; createdAt: Date }>> {
  const rows = await db
    .update(whatsappMessages)
    .set({ agentStatus: 'processing' })
    .where(and(
      eq(whatsappMessages.orgId, orgId),
      eq(whatsappMessages.conversationId, conversationId),
      eq(whatsappMessages.agentStatus, 'pending'),
    ))
    .returning({
      id: whatsappMessages.id,
      body: whatsappMessages.body,
      attachmentKind: whatsappMessages.attachmentKind,
      createdAt: whatsappMessages.createdAt,
    });

  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Marks claimed messages 'processed' or 'skipped', or reverts them to
 * 'pending' on a turn failure so they are retried by the next job/sweep.
 */
export async function finishClaimedInbound(
  ids: string[],
  status: 'processed' | 'skipped' | 'pending'
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(whatsappMessages)
    .set({ agentStatus: status })
    .where(inArray(whatsappMessages.id, ids));
}

/** True if any message for this conversation is still waiting on a turn. */
export async function hasPendingInbound(orgId: string, conversationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(and(
      eq(whatsappMessages.orgId, orgId),
      eq(whatsappMessages.conversationId, conversationId),
      eq(whatsappMessages.agentStatus, 'pending'),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Sweeper backstop: conversations with a 'pending' message older than
 * `olderThanMs` (the debounce job should have claimed it by now) but not so
 * old it's not worth resurrecting (`newerThanMs`). One row per conversation.
 */
export async function listStalePendingConversations(
  olderThanMs: number,
  newerThanMs: number,
  limit: number
): Promise<Array<{ orgId: string; conversationId: string }>> {
  const now = Date.now();
  const rows = await db
    .selectDistinctOn([whatsappMessages.conversationId], {
      orgId: whatsappMessages.orgId,
      conversationId: whatsappMessages.conversationId,
    })
    .from(whatsappMessages)
    .where(and(
      eq(whatsappMessages.agentStatus, 'pending'),
      lt(whatsappMessages.createdAt, new Date(now - olderThanMs)),
      gt(whatsappMessages.createdAt, new Date(now - newerThanMs)),
    ))
    .limit(limit);

  return rows;
}

/**
 * Outbound messages a human advisor sent (sender_kind='human') since the
 * session's last agent turn — passed to runAgentTurn as volatile turn
 * context (never cached history).
 */
export async function listHumanRepliesSince(
  orgId: string,
  conversationId: string,
  since: Date | null,
  limit = 10
): Promise<string[]> {
  const rows = await db
    .select({ body: whatsappMessages.body })
    .from(whatsappMessages)
    .where(and(
      eq(whatsappMessages.orgId, orgId),
      eq(whatsappMessages.conversationId, conversationId),
      eq(whatsappMessages.senderKind, 'human'),
      isNotNull(whatsappMessages.body),
      ...(since ? [gt(whatsappMessages.createdAt, since)] : []),
    ))
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(limit);

  return rows.map((r) => r.body).filter((b): b is string => b != null);
}

/**
 * Update conversation after a new message (last_message_at, unread_count_admin).
 */
export async function updateConversationActivity(
  conversationId: string,
  incrementUnreadCount: boolean
): Promise<void> {
  if (incrementUnreadCount) {
    await db
      .update(whatsappConversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        unreadCountAdmin: sql`${whatsappConversations.unreadCountAdmin} + 1`,
      })
      .where(eq(whatsappConversations.id, conversationId));
  } else {
    await db
      .update(whatsappConversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConversations.id, conversationId));
  }
}
