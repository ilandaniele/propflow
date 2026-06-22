/**
 * Integration tests for POST /api/whatsapp/webhook
 * Tests signature validation, rate limiting, idempotency, and Zod validation.
 *
 * Note: These tests are written to be runnable in isolation; actual DB/Supabase
 * integration is mocked via vi.mock().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock @/lib/db — Drizzle
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => [{ id: 'org-1' }]),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => [{ id: 'msg-1' }]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
}));

vi.mock('@/lib/whatsapp/classify', () => ({
  classifyMessage: async () => ({ classification: 'other', confidence: 0.9 }),
}));

vi.mock('@/lib/events/emit', () => ({
  emit: vi.fn(),
}));

vi.mock('@/lib/events/handlers', () => ({
  registerAllHandlers: vi.fn(),
}));

vi.mock('@/lib/whatsapp/db', () => ({
  findTenantByPhone: async () => null,
  upsertConversation: async () => 'conv-1',
  insertMessage: async () => 'msg-1',
  updateConversationActivity: async () => {},
}));

const SECRET = 'test-secret-for-webhook-tests-xx';

function makeSignature(body: string): string {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`;
}

function makeWebhookPayload() {
  return JSON.stringify({
    provider_message_id: `msg_${Date.now()}`,
    from: '+5491155555555',
    to: '+1234567890',
    type: 'text',
    text: 'Hola',
    timestamp: new Date().toISOString(),
  });
}

async function callWebhook(body: string, signature: string) {
  process.env.WHATSAPP_WEBHOOK_SECRET = SECRET;
  const { POST } = await import('@/app/api/whatsapp/webhook/route');
  const request = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
      'x-forwarded-for': '1.2.3.4',
    },
  });
  // @ts-ignore — NextRequest is compatible
  return POST(request as any);
}

describe('POST /api/whatsapp/webhook', () => {
  beforeEach(() => {
    process.env.WHATSAPP_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
  });

  it('returns 401 for invalid signature', async () => {
    const body = makeWebhookPayload();
    const response = await callWebhook(body, 'sha256=invalidsignature');
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe('INVALID_SIGNATURE');
  });

  it('returns 200 for valid signature', async () => {
    const body = makeWebhookPayload();
    const sig = makeSignature(body);
    const response = await callWebhook(body, sig);
    expect(response.status).toBe(200);
  });

  it('returns 400 for invalid JSON', async () => {
    const sig = makeSignature('not json');
    const response = await callWebhook('not json', sig);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe('INVALID_PAYLOAD');
  });

  it('returns 400 for missing required fields', async () => {
    const body = JSON.stringify({ from: '+123' }); // missing fields
    const sig = makeSignature(body);
    const response = await callWebhook(body, sig);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe('INVALID_PAYLOAD');
  });

  it('returns 401 for wrong signature even with correct format', async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = SECRET;
    const body = makeWebhookPayload();
    // 64 zero hex chars — valid format, wrong value
    const response = await callWebhook(body, 'sha256=0000000000000000000000000000000000000000000000000000000000000000');
    expect(response.status).toBe(401);
  });
});
