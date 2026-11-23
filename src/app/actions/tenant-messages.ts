'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { MessageIdSchema, ReplyMessageSchema, SendMessageSchema } from '@/lib/messages/schemas';
import { closeMessage, insertTenantMessage, replyToMessage, type StoredAttachment } from '@/lib/messages/queries';
import { ATTACHMENT_INVALID, buildMessageAttachmentKey, MESSAGE_ATTACHMENT_BUCKET, readMessageAttachment } from '@/lib/messages/attachment';
import { deleteImage, uploadFile } from '@/lib/storage';

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

  const parsed = SendMessageSchema.safeParse({ kind: formData.get('kind'), subject: formData.get('subject'), body: formData.get('body') });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const file = await readMessageAttachment(formData.get('attachment'));
  if (!file.ok) return Errors.VALIDATION_ERROR({ formErrors: [], fieldErrors: { attachment: [ATTACHMENT_INVALID] } });

  let attachment: StoredAttachment | null = null;
  if (file.attachment) {
    attachment = { key: buildMessageAttachmentKey(ctx.orgId, file.attachment.mime), name: file.attachment.name, mime: file.attachment.mime, size: file.attachment.size };
    try {
      await uploadFile(MESSAGE_ATTACHMENT_BUCKET, attachment.key, file.attachment.buffer, attachment.mime);
    } catch (error) {
      return failure('attachment_upload', error);
    }
  }

  try {
    await insertTenantMessage({ orgId: ctx.orgId, senderId: ctx.userId, ...parsed.data, attachment });
    revalidatePath(PORTAL_PATH);
    revalidatePath(INBOX_PATH);
    return { data: undefined };
  } catch (error) {
    if (attachment) await deleteImage(MESSAGE_ATTACHMENT_BUCKET, attachment.key).catch(() => undefined);
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
