'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import { insertMessage } from '@/lib/whatsapp/db';
import { SendWhatsAppMessageSchema } from '@/lib/schemas/whatsapp';
import type { ActionResult } from '@/lib/errors';

/**
 * Send a WhatsApp message from admin.
 * Writes outbound message to DB + calls provider (mock: no network).
 */
export async function sendWhatsappMessage(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'send_whatsapp');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SendWhatsAppMessageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { conversation_id, body } = parsed.data;

  const supabase = await createClient();

  // Verify conversation belongs to this org
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('id, external_phone, tenant_id')
    .eq('id', conversation_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!conv) return Errors.NOT_FOUND();

  // Call provider (mock: no network, logs only)
  const provider = getWhatsAppProvider();
  const sendResult = await provider.sendMessage(ctx.orgId, {
    to: conv.external_phone,  // PII — not logged by provider
    body,
  });

  const adminClient = createAdminClient();

  // Upsert conversation (already exists)
  const messageId = await insertMessage({
    adminClient,
    orgId: ctx.orgId,
    conversationId: conversation_id,
    direction: 'outbound',
    providerMessageId: sendResult.providerMessageId ?? null,
    body,
    status: sendResult.success ? 'sent' : 'failed',
  });

  if (!messageId) {
    log.error('[sendWhatsappMessage] insert failed', { orgId: ctx.orgId });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'send_whatsapp', 'conversation', conversation_id);
  revalidatePath(`/dashboard/whatsapp/${conversation_id}`);
  return ok(undefined);
}

/**
 * Mark a WhatsApp conversation as read (reset unread_count_admin to 0).
 */
export async function markConversationRead(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const conversationId = formData.get('conversation_id') as string;
  if (!conversationId) return Errors.VALIDATION_ERROR({ formErrors: ['conversation_id required'], fieldErrors: {} });

  const supabase = await createClient();
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({ unread_count_admin: 0, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[markConversationRead] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'mark_conversation_read', 'conversation', conversationId);
  revalidatePath('/dashboard/whatsapp');
  return ok(undefined);
}
