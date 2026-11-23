'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { MessageIdSchema, ReplyMessageSchema, SendMessageSchema } from '@/lib/messages/schemas';
import { closeMessage, insertTenantMessage, replyToMessage } from '@/lib/messages/queries';

const INBOX_PATH = '/dashboard/messages';
const PORTAL_PATH = '/portal/messages';

function failure(scope: string, error: unknown): ActionResult<never> {
  log.error(`tenant-messages.${scope}_failed`, { err: error instanceof Error ? error.message : String(error) });
  return Errors.INTERNAL();
}

export async function sendTenantMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'send-tenant-message').success) return Errors.RATE_LIMITED();

  const parsed = SendMessageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await insertTenantMessage({ orgId: ctx.orgId, senderId: ctx.userId, ...parsed.data });
    revalidatePath(PORTAL_PATH);
    revalidatePath(INBOX_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('send', error);
  }
}

export async function replyTenantMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'reply-tenant-message').success) return Errors.RATE_LIMITED();

  const parsed = ReplyMessageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    const replied = await replyToMessage({ orgId: ctx.orgId, messageId: parsed.data.message_id, reply: parsed.data.reply, repliedBy: ctx.userId });
    if (!replied) return Errors.NOT_FOUND();
    log.adminAction(ctx.userId, 'reply_tenant_message', 'tenant_message', parsed.data.message_id);
    revalidatePath(INBOX_PATH);
    revalidatePath(PORTAL_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('reply', error);
  }
}

export async function closeTenantMessage(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'close-tenant-message').success) return Errors.RATE_LIMITED();

  const parsed = MessageIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    if (!(await closeMessage(ctx.orgId, parsed.data.message_id))) return Errors.NOT_FOUND();
    log.adminAction(ctx.userId, 'close_tenant_message', 'tenant_message', parsed.data.message_id);
    revalidatePath(INBOX_PATH);
    revalidatePath(PORTAL_PATH);
    return { data: undefined };
  } catch (error) {
    return failure('close', error);
  }
}
