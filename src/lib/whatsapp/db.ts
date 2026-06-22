/**
 * WhatsApp DB helpers — upsert conversation, insert message, tenant lookup by phone.
 * Uses db directly (called from webhook handler, which runs outside user context).
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import {
  whatsappConversations,
  whatsappMessages,
  tenants,
} from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
          attachmentPath, attachmentKind, classification, status = 'received', meta = {} } = args;

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
      })
      .onConflictDoNothing()
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
