import { buildCopyPath, sanitizeSegment, sniffCopyMime } from '@/lib/airtable-final/attachments';
import { MessageAttachmentSchema, type MessageAttachmentMime } from './schemas';

export const MESSAGE_ATTACHMENT_BUCKET = 'tenant-messages';
export const ATTACHMENT_INVALID = 'Attachment must be a JPEG, PNG, WebP or PDF file up to 5 MB.';

export interface MessageAttachmentUpload {
  buffer: Buffer;
  mime: MessageAttachmentMime;
  name: string;
  size: number;
}

export type ReadAttachmentResult = { ok: true; attachment: MessageAttachmentUpload | null } | { ok: false };

export async function readMessageAttachment(value: FormDataEntryValue | null): Promise<ReadAttachmentResult> {
  if (!(value instanceof File) || value.size === 0) return { ok: true, attachment: null };

  const parsed = MessageAttachmentSchema.safeParse({ type: value.type, size: value.size, name: sanitizeSegment(value.name) });
  if (!parsed.success) return { ok: false };

  const buffer = Buffer.from(await value.arrayBuffer());
  if (sniffCopyMime(buffer) !== parsed.data.type) return { ok: false };

  return { ok: true, attachment: { buffer, mime: parsed.data.type, name: parsed.data.name, size: buffer.byteLength } };
}

export function buildMessageAttachmentKey(orgId: string, mime: MessageAttachmentMime): string {
  return buildCopyPath(orgId, MESSAGE_ATTACHMENT_BUCKET, mime);
}
