/**
 * Integration tests for POST /api/whatsapp/webhook
 * Tests signature validation, rate limiting, idempotency, and Zod validation.
 *
 * Note: These tests are written to be runnable in isolation; actual DB/Supabase
 * integration is mocked via vi.mock().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// vi.mock factories are hoisted above regular declarations, so any mock fns
// they close over must be created via vi.hoisted() to avoid a TDZ error.
const {
  findOrgIdByWhatsAppPhoneNumberId,
  updateMessageStatusByProviderId,
  findTenantByPhone,
  mockProvider,
  getOrCreateAgentConfig,
  queueAgentInbound,
  scheduleAgentDrain,
  insertMessage,
  dispatchButtonReply,
  getSessionByConversation,
  touchInbound,
} = vi.hoisted(() => ({
  findOrgIdByWhatsAppPhoneNumberId: vi.fn(async () => null as string | null),
  updateMessageStatusByProviderId: vi.fn(async () => {}),
  findTenantByPhone: vi.fn(async () => null as { id: string; profile_id: string | null; preferred_language: string } | null),
  mockProvider: {
    sendMessage: vi.fn(),
    validateWebhookSignature: vi.fn(),
    downloadAttachment: vi.fn(async () => ({ storagePath: 'whatsapp/org-1/conv-1/wamid.1' })),
    verifyWebhookToken: vi.fn((token: string) => token === 'correct-verify-token'),
  },
  getOrCreateAgentConfig: vi.fn(async () => ({ channelsEnabled: { whatsapp: false, web: false, voice: false } })),
  queueAgentInbound: vi.fn(async () => true),
  scheduleAgentDrain: vi.fn(),
  insertMessage: vi.fn(async () => 'msg-1' as string | null),
  dispatchButtonReply: vi.fn(async () => false),
  getSessionByConversation: vi.fn(async () => null as { id: string } | null),
  touchInbound: vi.fn(async () => {}),
}));

vi.mock('@/lib/whatsapp/db', () => ({
  findTenantByPhone,
  upsertConversation: async () => 'conv-1',
  insertMessage,
  updateConversationActivity: async () => {},
  findOrgIdByWhatsAppPhoneNumberId,
  updateMessageStatusByProviderId,
  finishClaimedInbound: vi.fn(async () => {}),
}));

vi.mock('@/lib/whatsapp', () => ({
  getWhatsAppProvider: () => mockProvider,
}));

vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));

vi.mock('@/lib/agent/whatsapp-dispatch', () => ({ queueAgentInbound, scheduleAgentDrain }));

vi.mock('@/lib/agent/job-handlers', () => ({ registerAgentJobHandlers: vi.fn() }));

vi.mock('@/lib/agent/button-replies', () => ({ dispatchButtonReply }));

vi.mock('@/lib/agent/session', () => ({
  getSessionByConversation,
  touchInbound,
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

  // Item 5: the mock-provider payload shape is dev/test-only — a stray
  // mock-shaped POST reaching a production deploy must never feed the live
  // agent (bogus sessions/leads on a signature scheme Meta never uses).
  describe('mock payload must never queue the agent in production (item 5)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('does not queue when NODE_ENV=production', async () => {
      getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
      vi.stubEnv('NODE_ENV', 'production');

      const body = makeWebhookPayload();
      const response = await callWebhook(body, makeSignature(body));

      expect(response.status).toBe(200);
      expect(queueAgentInbound).not.toHaveBeenCalled();
    });

    it('still queues outside production (dev/test)', async () => {
      getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
      vi.stubEnv('NODE_ENV', 'test');

      const body = makeWebhookPayload();
      const response = await callWebhook(body, makeSignature(body));

      expect(response.status).toBe(200);
      expect(queueAgentInbound).toHaveBeenCalledOnce();
    });
  });
});

describe('GET /api/whatsapp/webhook (Meta subscription handshake)', () => {
  it('echoes hub.challenge back on a valid verify token', async () => {
    const { GET } = await import('@/app/api/whatsapp/webhook/route');
    const url = 'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=correct-verify-token&hub.challenge=1234567890';
    const response = await GET(new Request(url) as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1234567890');
  });

  it('returns 403 on a wrong verify token', async () => {
    const { GET } = await import('@/app/api/whatsapp/webhook/route');
    const url = 'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234567890';
    const response = await GET(new Request(url) as any);
    expect(response.status).toBe(403);
  });

  it('returns 400 when hub.challenge is missing', async () => {
    const { GET } = await import('@/app/api/whatsapp/webhook/route');
    const url = 'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=correct-verify-token';
    const response = await GET(new Request(url) as any);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/whatsapp/webhook (real Meta payload)', () => {
  const META_SECRET = 'test-meta-app-secret-xx';

  function metaSignature(body: string): string {
    return `sha256=${crypto.createHmac('sha256', META_SECRET).update(Buffer.from(body)).digest('hex')}`;
  }

  function metaBody(overrides: { messages?: unknown[]; statuses?: unknown[] } = {}) {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid-1', display_phone_number: '15550001111' },
                messages: overrides.messages ?? [
                  { id: 'wamid.1', from: '51987654321', timestamp: '1700000000', type: 'text', text: { body: 'Hola' } },
                ],
                statuses: overrides.statuses,
              },
            },
          ],
        },
      ],
    });
  }

  async function callMetaWebhook(body: string, signature: string) {
    process.env.META_APP_SECRET = META_SECRET;
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const request = new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '5.6.7.8',
      },
    });
    // @ts-ignore — NextRequest is compatible
    return POST(request as any);
  }

  beforeEach(() => {
    process.env.META_APP_SECRET = META_SECRET;
    vi.clearAllMocks();
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue(null);
  });

  it('returns 401 for an invalid X-Hub-Signature-256', async () => {
    const body = metaBody();
    const response = await callMetaWebhook(body, 'sha256=invalid');
    expect(response.status).toBe(401);
  });

  it('returns 200 and skips unrouted org_channels without crashing', async () => {
    const body = metaBody();
    const response = await callMetaWebhook(body, metaSignature(body));
    expect(response.status).toBe(200);
    expect(findOrgIdByWhatsAppPhoneNumberId).toHaveBeenCalledWith('pnid-1');
  });

  it('updates message status when org_channels resolves', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    const body = metaBody({ messages: [], statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }] });
    const response = await callMetaWebhook(body, metaSignature(body));
    expect(response.status).toBe(200);
    expect(updateMessageStatusByProviderId).toHaveBeenCalledWith('org-1', 'wamid.1', 'delivered');
  });

  it('queues an agent turn for a non-tenant when WhatsApp is enabled, and drains', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    findTenantByPhone.mockResolvedValue(null);
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
    const body = metaBody();
    const response = await callMetaWebhook(body, metaSignature(body));
    expect(response.status).toBe(200);
    expect(queueAgentInbound).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', conversationId: 'conv-1' }));
    expect(scheduleAgentDrain).toHaveBeenCalled();
  });

  it('does not queue an agent turn for a tenant, even with WhatsApp enabled', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    findTenantByPhone.mockResolvedValue({ id: 'tenant-1', profile_id: null, preferred_language: 'es' });
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
    const body = metaBody();
    const response = await callMetaWebhook(body, metaSignature(body));
    expect(response.status).toBe(200);
    expect(queueAgentInbound).not.toHaveBeenCalled();
    expect(scheduleAgentDrain).not.toHaveBeenCalled();
  });

  it('does not queue an agent turn for a duplicate message (insertMessage returns null)', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    findTenantByPhone.mockResolvedValue(null);
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
    insertMessage.mockResolvedValueOnce(null);
    const body = metaBody();
    const response = await callMetaWebhook(body, metaSignature(body));
    expect(response.status).toBe(200);
    expect(queueAgentInbound).not.toHaveBeenCalled();
    expect(scheduleAgentDrain).not.toHaveBeenCalled();
  });

  // Item 6: touchInbound must run for every inbound linked to an agent
  // session, even when a button-reply handler fully handles the message and
  // short-circuits before queueAgentInbound (which normally owns the call).
  it('touches the session window when a button-reply handler short-circuits the agent pipeline', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    findTenantByPhone.mockResolvedValue(null);
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
    dispatchButtonReply.mockResolvedValueOnce(true);
    getSessionByConversation.mockResolvedValueOnce({ id: 'session-1' });

    const body = metaBody({
      messages: [{
        id: 'wamid.2', from: '51987654321', timestamp: '1700000000', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'opt-1', title: 'Sí' } },
      }],
    });
    const response = await callMetaWebhook(body, metaSignature(body));

    expect(response.status).toBe(200);
    expect(dispatchButtonReply).toHaveBeenCalled();
    expect(touchInbound).toHaveBeenCalledWith('session-1');
    expect(queueAgentInbound).not.toHaveBeenCalled(); // handled outside the agent pipeline
  });

  it('does not touch a session that does not exist for the conversation', async () => {
    findOrgIdByWhatsAppPhoneNumberId.mockResolvedValue('org-1');
    findTenantByPhone.mockResolvedValue(null);
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false } });
    dispatchButtonReply.mockResolvedValueOnce(true);
    getSessionByConversation.mockResolvedValueOnce(null);

    const body = metaBody({
      messages: [{
        id: 'wamid.3', from: '51987654321', timestamp: '1700000000', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'opt-1', title: 'Sí' } },
      }],
    });
    const response = await callMetaWebhook(body, metaSignature(body));

    expect(response.status).toBe(200);
    expect(touchInbound).not.toHaveBeenCalled();
  });
});
