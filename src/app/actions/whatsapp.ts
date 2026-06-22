'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { getWhatsAppProvider } from '@/lib/whatsapp';
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

  // Verify conversation belongs to this org (IDOR guard)
  const convRows = await db
    .select({ id: whatsappConversations.id, externalPhone: whatsappConversations.externalPhone })
    .from(whatsappConversations)
    .where(and(eq(whatsappConversations.id, conversation_id), eq(whatsappConversations.orgId, ctx.orgId)))
    .limit(1);

  if (!convRows[0]) return Errors.NOT_FOUND();
  const conv = convRows[0];

  // Call provider (mock: no network, logs only)
  const provider = getWhatsAppProvider();
  const sendResult = await provider.sendMessage(ctx.orgId, {
    to: conv.externalPhone,  // PII — not logged by provider
    body,
  });

  // Insert outbound message directly with Drizzle
  let messageId: string | null = null;
  try {
    const rows = await db
      .insert(whatsappMessages)
      .values({
        orgId:             ctx.orgId,
        conversationId:    conversation_id,
        direction:         'outbound',
        providerMessageId: sendResult.providerMessageId ?? null,
        body:              body ?? null,
        status:            sendResult.success ? 'sent' : 'failed',
        meta:              {},
      })
      .returning({ id: whatsappMessages.id });

    messageId = rows[0]?.id ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 23505 = unique_violation — idempotent duplicate
    if (msg.includes('23505')) {
      log.info('[sendWhatsappMessage] duplicate message ignored', { orgId: ctx.orgId });
    } else {
      log.error('[sendWhatsappMessage] insert failed', { orgId: ctx.orgId, code: msg });
      return Errors.INTERNAL();
    }
  }

  if (!messageId) {
    log.error('[sendWhatsappMessage] insert returned no id', { orgId: ctx.orgId });
    return Errors.INTERNAL();
  }

  // Update conversation last_message_at
  await db
    .update(whatsappConversations)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappConversations.id, conversation_id))
    .catch(() => undefined);

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

  try {
    await db
      .update(whatsappConversations)
      .set({ unreadCountAdmin: 0, updatedAt: new Date() })
      .where(and(eq(whatsappConversations.id, conversationId), eq(whatsappConversations.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[markConversationRead] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'mark_conversation_read', 'conversation', conversationId);
  revalidatePath('/dashboard/whatsapp');
  return ok(undefined);
}
