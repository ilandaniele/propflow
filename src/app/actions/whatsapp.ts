'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { whatsappConversations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { sendWhatsAppText } from '@/lib/agent/outbound';
import { getSessionByConversation, setSessionMode } from '@/lib/agent/session';
import { recordAgentEvent } from '@/lib/agent/events';
import { SendWhatsAppMessageSchema } from '@/lib/schemas/whatsapp';
import type { ActionResult } from '@/lib/errors';

/**
 * Send a WhatsApp message from admin.
 *
 * Routes through sendWhatsAppText (agent/outbound.ts) — the only place that
 * sends WhatsApp free text — so the 24h window, provider call and message
 * persistence stay in one place shared with the agent inbox. If an agent
 * session exists for this conversation and is still in 'ai' mode, a human
 * sending here takes it over first so the bot doesn't talk over staff.
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

  const session = await getSessionByConversation(ctx.orgId, conversation_id);
  if (session && session.mode === 'ai') {
    await setSessionMode(session.id, 'human', undefined, 'manual');
    await recordAgentEvent({
      orgId: ctx.orgId,
      sessionId: session.id,
      kind: 'mode_change',
      data: { to: 'human', implicit: true },
      actorProfileId: ctx.userId,
    });
  }

  const outcome = await sendWhatsAppText({
    orgId: ctx.orgId,
    conversationId: conversation_id,
    body,
    senderKind: 'human',
    sentByProfileId: ctx.userId,
  });

  if (!outcome.ok) {
    if (outcome.code === 'WINDOW_CLOSED') {
      return err('WINDOW_CLOSED', 'Fuera de la ventana de 24 h: solo plantillas aprobadas');
    }
    if (outcome.code === 'NOT_FOUND') return Errors.NOT_FOUND();
    log.error('[sendWhatsappMessage] send failed', { orgId: ctx.orgId, code: outcome.code });
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
