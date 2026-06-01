import { describe, it, expect, beforeEach } from 'vitest';
import { MockWhatsAppProvider } from '@/lib/whatsapp/mock-provider';

describe('MockWhatsAppProvider', () => {
  let provider: MockWhatsAppProvider;

  beforeEach(() => {
    provider = new MockWhatsAppProvider();
  });

  it('sendMessage returns success with a fake providerMessageId', async () => {
    const result = await provider.sendMessage('org-1', {
      to: '+5491155555555',
      body: 'Hello',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock_/);
  });

  it('sendMessage does not throw or make network calls', async () => {
    // If a network call were made, it would fail in test environment
    const result = await provider.sendMessage('org-1', {
      to: '+1234567890',
      body: 'Test message',
    });
    expect(result).toBeDefined();
  });

  it('validateWebhookSignature returns false when secret is missing', () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    const result = provider.validateWebhookSignature(
      Buffer.from('test'),
      'sha256=abc123'
    );
    expect(result).toBe(false);
  });

  it('validateWebhookSignature returns true for valid signature', () => {
    const secret = 'test-secret-32bytes-xxxxxxxxxxxxx';
    process.env.WHATSAPP_WEBHOOK_SECRET = secret;

    const crypto = require('crypto');
    const body = Buffer.from('{"test":"payload"}');
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const signature = `sha256=${expected}`;

    const result = provider.validateWebhookSignature(body, signature);
    expect(result).toBe(true);

    delete process.env.WHATSAPP_WEBHOOK_SECRET;
  });

  it('validateWebhookSignature returns false for invalid signature', () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = 'test-secret-32bytes-xxxxxxxxxxxxx';
    const result = provider.validateWebhookSignature(
      Buffer.from('test'),
      'sha256=invalidsignature'
    );
    expect(result).toBe(false);
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
  });

  it('downloadAttachment returns storagePath without network calls', async () => {
    const result = await provider.downloadAttachment(
      'org-1',
      'https://example.com/attachment.jpg',
      'task-proofs',
      'org-1/task-1/proof.jpg'
    );
    expect(result.storagePath).toBe('org-1/task-1/proof.jpg');
  });
});
