import { z } from 'zod';
import { ALLOWED_RECEIPT_MIMES, MAX_RECEIPT_BYTES } from '@/lib/schemas/finance';

export const MESSAGE_KINDS = ['question', 'request', 'complaint', 'suggestion'] as const;
export const MESSAGE_STATUSES = ['open', 'answered', 'closed'] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const SendMessageSchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(2000),
});

export const MESSAGE_ATTACHMENT_MIMES = ALLOWED_RECEIPT_MIMES;
export const MAX_MESSAGE_ATTACHMENT_BYTES = MAX_RECEIPT_BYTES;
export type MessageAttachmentMime = (typeof MESSAGE_ATTACHMENT_MIMES)[number];

export const MessageAttachmentSchema = z.object({
  type: z.enum(MESSAGE_ATTACHMENT_MIMES),
  size: z.number().int().positive().max(MAX_MESSAGE_ATTACHMENT_BYTES),
  name: z.string().min(1).max(255),
});

export const ReplyMessageSchema = z.object({
  message_id: z.string().uuid(),
  reply: z.string().trim().min(2).max(2000),
});

export const MessageIdSchema = z.object({ message_id: z.string().uuid() });

export const InboxFilterSchema = z.object({
  status: z.enum(MESSAGE_STATUSES).optional().catch(undefined),
});
