/**
 * Integration tests for GET/POST /api/agent/web/messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';

const {
  resolveWebChannel,
  authenticateWebSession,
  listWebTranscript,
  handleWebMessage,
} = vi.hoisted(() => ({
  resolveWebChannel: vi.fn(),
  authenticateWebSession: vi.fn(),
  listWebTranscript: vi.fn(async () => [] as unknown[]),
  handleWebMessage: vi.fn(),
}));

vi.mock('@/lib/widget/channel', () => ({ resolveWebChannel }));
vi.mock('@/lib/widget/web-session', () => ({ authenticateWebSession, listWebTranscript }));
vi.mock('@/lib/widget/web-turn', () => ({ handleWebMessage }));

import { GET, POST } from '@/app/api/agent/web/messages/route';

const CHANNEL = {
  orgId: 'org-1',
  channelId: 'chan-1',
  publicKey: 'pk_ABCDEFGHIJKLMNOPQRSTUVWX',
  orgName: 'Acme Realty',
  enabled: true,
  allowedOrigins: ['https://host-a.example.com'],
  dailyMessageCap: 300,
  dailySessionCap: 150,
  greeting: 'Hola!',
  accentColor: null,
  whatsappDisplayPhone: '+51999999999',
};

const SESSION = {
  id: 'ws-1',
  orgId: 'org-1',
  agentSessionId: 'as-1',
  currentListingId: null,
  phoneE164: null,
  messageCount: 0,
  expiresAt: new Date('2026-11-01T00:00:00Z'),
};

function makePostRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.example.com/api/agent/web/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      authorization: 'Bearer wst_faketoken',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://app.example.com/api/agent/web/messages${query}`, {
    method: 'GET',
    headers: { origin: 'https://app.example.com', authorization: 'Bearer wst_faketoken', ...headers },
  });
}

describe('POST /api/agent/web/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWebChannel.mockResolvedValue(CHANNEL);
    authenticateWebSession.mockResolvedValue(SESSION);
    handleWebMessage.mockResolvedValue({ status: 200, body: { reply: 'hola!', mode: 'ai', cta: null } });
  });

  it('rejects a request from a foreign origin', async () => {
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }, { origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    expect(handleWebMessage).not.toHaveBeenCalled();
  });

  it('401s on a bad/expired bearer token', async () => {
    authenticateWebSession.mockResolvedValue(null);
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('SESSION');
    expect(handleWebMessage).not.toHaveBeenCalled();
  });

  it('propagates a 429 rate-limit response from handleWebMessage', async () => {
    handleWebMessage.mockResolvedValue({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 1000 } } });
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }));
    expect(res.status).toBe(429);
  });

  it('propagates a 503 daily-cap response with a CTA', async () => {
    handleWebMessage.mockResolvedValue({ status: 503, body: { reply: 'límite alcanzado', mode: 'handoff', cta: { kind: 'whatsapp', url: 'https://wa.me/51999999999', label: 'Seguir por WhatsApp', code: 'WEB-AAAAAA', purpose: 'continue' } } });
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.cta).toBeTruthy();
  });

  it('propagates a 409 when the session is busy (lock held)', async () => {
    handleWebMessage.mockResolvedValue({ status: 409, body: { error: { code: 'BUSY', message: 'busy' } } });
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }));
    expect(res.status).toBe(409);
  });

  it('calls handleWebMessage with the resolved channel + session + text', async () => {
    await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola, busco depa', listingRef: 'depa-1' }));
    expect(handleWebMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: CHANNEL,
      session: SESSION,
      text: 'hola, busco depa',
      listingRef: 'depa-1',
    }));
  });

  it('surfaces mode: handoff from handleWebMessage', async () => {
    handleWebMessage.mockResolvedValue({ status: 200, body: { reply: 'un asesor te contacta', mode: 'handoff', cta: null } });
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'quiero hablar con alguien' }));
    const body = await res.json();
    expect(body.mode).toBe('handoff');
  });

  it('rejects an empty message via validation before ever calling handleWebMessage', async () => {
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: '' }));
    expect(res.status).toBe(400);
    expect(handleWebMessage).not.toHaveBeenCalled();
  });

  it('returns a generic 500 (never leaking details) when handleWebMessage throws', async () => {
    handleWebMessage.mockRejectedValue(new Error('boom with a phone number +51987654321'));
    const res = await POST(makePostRequest({ publicKey: CHANNEL.publicKey, text: 'hola' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('987654321');
  });
});

describe('GET /api/agent/web/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWebChannel.mockResolvedValue(CHANNEL);
    authenticateWebSession.mockResolvedValue(SESSION);
    listWebTranscript.mockResolvedValue([{ role: 'user', text: 'hola', at: '2026-01-01T00:00:00.000Z' }]);
  });

  it('returns the transcript for a valid bearer token', async () => {
    const res = await GET(makeGetRequest(`?publicKey=${CHANNEL.publicKey}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
  });

  it('401s without a valid session', async () => {
    authenticateWebSession.mockResolvedValue(null);
    const res = await GET(makeGetRequest(`?publicKey=${CHANNEL.publicKey}`));
    expect(res.status).toBe(401);
  });
});
