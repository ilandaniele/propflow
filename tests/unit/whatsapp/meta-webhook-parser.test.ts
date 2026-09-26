import { describe, it, expect } from 'vitest';
import { isMetaWebhookBody, parseMetaWebhookBody } from '@/lib/whatsapp/meta-webhook-parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaEnvelope(value: any) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [{ field: 'messages', value }],
      },
    ],
  };
}

describe('isMetaWebhookBody', () => {
  it('recognizes the real Meta envelope', () => {
    expect(isMetaWebhookBody(metaEnvelope({}))).toBe(true);
  });

  it('rejects the flat mock payload', () => {
    expect(isMetaWebhookBody({ provider_message_id: 'x', from: '+123' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isMetaWebhookBody('not json')).toBe(false);
    expect(isMetaWebhookBody(null)).toBe(false);
  });
});

describe('parseMetaWebhookBody', () => {
  it('parses a text message', () => {
    const body = metaEnvelope({
      metadata: { phone_number_id: 'pnid-1', display_phone_number: '15550001111' },
      messages: [
        { id: 'wamid.1', from: '51987654321', timestamp: '1700000000', type: 'text', text: { body: 'Hola' } },
      ],
    });

    const changes = parseMetaWebhookBody(body);
    expect(changes).toHaveLength(1);
    expect(changes[0].phoneNumberId).toBe('pnid-1');
    expect(changes[0].messages).toEqual([
      {
        providerMessageId: 'wamid.1',
        from: '51987654321',
        type: 'text',
        text: 'Hola',
        mediaId: null,
        mimeType: null,
        timestamp: new Date(1700000000 * 1000).toISOString(),
        interactiveReplyId: null,
        referral: null,
      },
    ]);
  });

  it('parses an image message into mediaId/mimeType', () => {
    const body = metaEnvelope({
      metadata: { phone_number_id: 'pnid-1' },
      messages: [
        {
          id: 'wamid.2',
          from: '51987654321',
          timestamp: '1700000000',
          type: 'image',
          image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'recibo' },
        },
      ],
    });

    const [change] = parseMetaWebhookBody(body);
    expect(change.messages[0]).toMatchObject({
      type: 'image',
      mediaId: 'media-1',
      mimeType: 'image/jpeg',
      text: 'recibo',
    });
  });

  it('parses an interactive button_reply into text + interactiveReplyId', () => {
    const body = metaEnvelope({
      metadata: { phone_number_id: 'pnid-1' },
      messages: [
        {
          id: 'wamid.3',
          from: '51987654321',
          timestamp: '1700000000',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'task:1:listo', title: 'Listo' } },
        },
      ],
    });

    const [change] = parseMetaWebhookBody(body);
    expect(change.messages[0]).toMatchObject({ type: 'text', text: 'Listo', interactiveReplyId: 'task:1:listo' });
  });

  it('parses status callbacks', () => {
    const body = metaEnvelope({
      metadata: { phone_number_id: 'pnid-1' },
      statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }],
    });

    const [change] = parseMetaWebhookBody(body);
    expect(change.statuses).toEqual([
      { providerMessageId: 'wamid.1', status: 'delivered', timestamp: new Date(1700000000 * 1000).toISOString() },
    ]);
  });

  it('ignores unsupported message types instead of throwing', () => {
    const body = metaEnvelope({
      metadata: { phone_number_id: 'pnid-1' },
      messages: [{ id: 'wamid.4', from: '51987654321', timestamp: '1700000000', type: 'location', location: {} }],
    });

    const [change] = parseMetaWebhookBody(body);
    expect(change.messages).toEqual([]);
  });

  it('skips changes with no phone_number_id', () => {
    const body = metaEnvelope({ metadata: {}, messages: [] });
    expect(parseMetaWebhookBody(body)).toEqual([]);
  });

  it('ignores non-"messages" fields', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [{ field: 'other', value: { metadata: { phone_number_id: 'x' } } }] }],
    };
    expect(parseMetaWebhookBody(body)).toEqual([]);
  });
});
