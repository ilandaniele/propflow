import { describe, it, expect } from 'vitest';
import { InboxFilterSchema, ReplyMessageSchema, SendMessageSchema } from '@/lib/messages/schemas';

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
