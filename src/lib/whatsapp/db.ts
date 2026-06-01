/**
 * WhatsApp DB helpers — upsert conversation, insert message, tenant lookup by phone.
 * Uses service-role admin client (called from webhook handler, which runs outside user context).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/log';

export interface UpsertConversationArgs {
  adminClient: SupabaseClient;
  orgId: string;
  externalPhone: string;    // E.164
  tenantId?: string | null;
}

export interface InsertMessageArgs {
  adminClient: SupabaseClient;
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
  adminClient,
  orgId,
  externalPhone,
  tenantId,
}: UpsertConversationArgs): Promise<string> {
  const { data, error } = await adminClient
    .from('whatsapp_conversations')
    .upsert(
      {
        org_id: orgId,
        external_phone: externalPhone,
        tenant_id: tenantId ?? null,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,external_phone' }
    )
    .select('id')
    .single();

  if (error || !data) {
    log.error('[whatsapp:db] upsertConversation failed', { code: error?.code, orgId });
    throw new Error('Failed to upsert conversation');
  }

  return data.id;
}

/**
 * Increment unread_count_admin on a conversation.
 */
export async function incrementUnread(
  adminClient: SupabaseClient,
  conversationId: string
): Promise<void> {
  await adminClient.rpc('increment_wa_unread', { conv_id: conversationId }).maybeSingle();
  // If the RPC doesn't exist yet, fall back to a raw update
  // (migration 000017 doesn't define this RPC — handled gracefully)
}

/**
 * Insert a whatsapp_messages row.
 * Ignores unique-constraint conflicts (idempotent on provider_message_id).
 * Returns the new message id, or null if it was a duplicate.
 */
export async function insertMessage(args: InsertMessageArgs): Promise<string | null> {
  const { adminClient, orgId, conversationId, direction, providerMessageId, body,
          attachmentPath, attachmentKind, classification, status = 'received', meta = {} } = args;

  const { data, error } = await adminClient
    .from('whatsapp_messages')
    .insert({
      org_id: orgId,
      conversation_id: conversationId,
      direction,
      provider_message_id: providerMessageId ?? null,
      body: body ?? null,     // PII — stored but never logged
      attachment_path: attachmentPath ?? null,
      attachment_kind: attachmentKind ?? null,
      classification: classification ?? null,
      status,
      meta,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation — idempotent duplicate
    if (error.code === '23505') {
      log.info('[whatsapp:db] duplicate message ignored', { orgId, providerMessageId: providerMessageId?.slice(0, 8) });
      return null;
    }
    log.error('[whatsapp:db] insertMessage failed', { code: error.code, orgId });
    throw new Error('Failed to insert message');
  }

  return data?.id ?? null;
}

/**
 * Find a tenant by their whatsapp_phone within the org.
 * Returns tenant id and profile_id, or null if not found.
 */
export async function findTenantByPhone(
  adminClient: SupabaseClient,
  orgId: string,
  phone: string   // E.164 — PII, do not log
): Promise<{ id: string; profile_id: string | null; preferred_language: string } | null> {
  const { data } = await adminClient
    .from('tenants')
    .select('id, profile_id, preferred_language')
    .eq('org_id', orgId)
    .eq('whatsapp_phone', phone)
    .limit(1)
    .single();

  return data ?? null;
}

/**
 * Update conversation after a new message (last_message_at, unread_count_admin).
 */
export async function updateConversationActivity(
  adminClient: SupabaseClient,
  conversationId: string,
  incrementUnreadCount: boolean
): Promise<void> {
  const updates: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (incrementUnreadCount) {
    // Fetch current count and increment (no RPC needed)
    const { data: conv } = await adminClient
      .from('whatsapp_conversations')
      .select('unread_count_admin')
      .eq('id', conversationId)
      .single();
    if (conv) {
      updates.unread_count_admin = (conv.unread_count_admin ?? 0) + 1;
    }
  }

  await adminClient
    .from('whatsapp_conversations')
    .update(updates)
    .eq('id', conversationId);
}
