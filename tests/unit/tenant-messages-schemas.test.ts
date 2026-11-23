import { describe, it, expect } from 'vitest';
import { InboxFilterSchema, MAX_MESSAGE_ATTACHMENT_BYTES, MessageAttachmentSchema, ReplyMessageSchema, SendMessageSchema } from '@/lib/messages/schemas';

describe('SendMessageSchema', () => {
  it('accepts a valid message and trims text', () => {
    expect(SendMessageSchema.parse({ kind: 'request', subject: '  Leaky tap ', body: ' Kitchen tap drips. ' }))
      .toEqual({ kind: 'request', subject: 'Leaky tap', body: 'Kitchen tap drips.' });
  });

  it('rejects unknown kinds and too-short text', () => {
    expect(SendMessageSchema.safeParse({ kind: 'spam', subject: 'Hello', body: 'Hello there' }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ kind: 'question', subject: 'Hi', body: 'Hello there' }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ kind: 'question', subject: 'Hello', body: 'Hey' }).success).toBe(false);
  });
});

describe('ReplyMessageSchema', () => {
  it('requires a uuid message id', () => {
    expect(ReplyMessageSchema.safeParse({ message_id: 'nope', reply: 'Done' }).success).toBe(false);
  });
});

describe('InboxFilterSchema', () => {
  it('keeps known statuses and drops unknown ones', () => {
    expect(InboxFilterSchema.parse({ status: 'open' })).toEqual({ status: 'open' });
    expect(InboxFilterSchema.parse({ status: 'weird' })).toEqual({ status: undefined });
    expect(InboxFilterSchema.parse({})).toEqual({});
  });
});

describe('MessageAttachmentSchema', () => {
  it('accepts images and PDFs up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(MessageAttachmentSchema.safeParse({ type, size: 1024, name: 'file' }).success).toBe(true);
    }
    expect(MessageAttachmentSchema.safeParse({ type: 'application/pdf', size: MAX_MESSAGE_ATTACHMENT_BYTES, name: 'a.pdf' }).success).toBe(true);
  });

  it('rejects other types, oversize, empty files and missing names', () => {
    expect(MessageAttachmentSchema.safeParse({ type: 'image/svg+xml', size: 10, name: 'x.svg' }).success).toBe(false);
    expect(MessageAttachmentSchema.safeParse({ type: 'text/html', size: 10, name: 'x.html' }).success).toBe(false);
    expect(MessageAttachmentSchema.safeParse({ type: 'application/pdf', size: MAX_MESSAGE_ATTACHMENT_BYTES + 1, name: 'a.pdf' }).success).toBe(false);
    expect(MessageAttachmentSchema.safeParse({ type: 'application/pdf', size: 0, name: 'a.pdf' }).success).toBe(false);
    expect(MessageAttachmentSchema.safeParse({ type: 'application/pdf', size: 10, name: '' }).success).toBe(false);
  });
});
