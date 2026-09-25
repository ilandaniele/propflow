/**
 * Integration tests for POST /api/agent/web/session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';

const { resolveWebChannel, createWebSession, hashIp, incrementWebUsage, webSessionCreateRateLimit } = vi.hoisted(() => ({
  resolveWebChannel: vi.fn(),
  createWebSession: vi.fn(),
  hashIp: vi.fn((ip: string) => `hashed:${ip}`),
  incrementWebUsage: vi.fn(async () => ({ allowed: true, count: 1 })),
  webSessionCreateRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
}));

vi.mock('@/lib/widget/channel', () => ({ resolveWebChannel }));
vi.mock('@/lib/widget/web-session', () => ({ createWebSession, hashIp }));
vi.mock('@/lib/widget/usage', () => ({ incrementWebUsage }));
vi.mock('@/lib/ratelimit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ratelimit')>('@/lib/ratelimit');
  return { ...actual, webSessionCreateRateLimit };
});

import { POST } from '@/app/api/agent/web/session/route';

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

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.example.com/api/agent/web/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example.com', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent/web/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWebChannel.mockResolvedValue(CHANNEL);
    webSessionCreateRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
    incrementWebUsage.mockResolvedValue({ allowed: true, count: 1 });
    createWebSession.mockResolvedValue({
      session: { id: 'ws-1', orgId: 'org-1', agentSessionId: null, currentListingId: null, phoneE164: null, messageCount: 0, expiresAt: new Date('2026-11-01T00:00:00Z') },
      token: 'wst_faketoken',
    });
  });

  it('rejects a request from a foreign origin', async () => {
    const res = await POST(makeRequest({ publicKey: CHANNEL.publicKey }, { origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN_ORIGIN');
    expect(createWebSession).not.toHaveBeenCalled();
  });

  it('rate-limits repeated session creation', async () => {
    webSessionCreateRateLimit.mockReturnValue({ success: false, retryAfterMs: 5000 });
    const res = await POST(makeRequest({ publicKey: CHANNEL.publicKey }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('404s for an unknown or disabled public key', async () => {
    resolveWebChannel.mockResolvedValue(null);
    const res = await POST(makeRequest({ publicKey: 'pk_doesnotexist000000000' }));
    expect(res.status).toBe(404);
  });

  it('503s with DAILY_CAP once the org daily session cap is hit', async () => {
    incrementWebUsage.mockResolvedValue({ allowed: false, count: 999 });
    const res = await POST(makeRequest({ publicKey: CHANNEL.publicKey }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('DAILY_CAP');
  });

  it('creates a session and returns the token, greeting and whatsappAvailable', async () => {
    const res = await POST(makeRequest({ publicKey: CHANNEL.publicKey }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe('wst_faketoken');
    expect(body.greeting).toBe('Hola!');
    expect(body.whatsappAvailable).toBe(true);
    expect(createWebSession).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));
  });
});
