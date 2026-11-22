import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const limitIp = vi.fn();
vi.mock('@/lib/ratelimit-edge', () => ({ limitIp: (...args: unknown[]) => limitIp(...args) }));

import { proxy } from '@/proxy';

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), init);
}

beforeEach(() => {
  limitIp.mockReset();
  limitIp.mockResolvedValue({ success: true, retryAfterMs: 0 });
});

describe('proxy — edge IP rate limit', () => {
  it.each([
    ['/api/tenants', 'GET', 'RL_IP_API'],
    ['/api/auth/callback/google', 'GET', 'RL_IP_AUTH'],
    ['/login', 'POST', 'RL_IP_AUTH'],
    ['/register', 'POST', 'RL_IP_AUTH'],
  ])('%s %s uses %s keyed by cf-connecting-ip', async (path, method, binding) => {
    await proxy(req(path, { method, headers: { 'cf-connecting-ip': '198.51.100.7' } }));
    expect(limitIp).toHaveBeenCalledWith(binding, '198.51.100.7');
  });

  it.each([
    ['/api/whatsapp/webhook', 'POST'],
    ['/api/cron/agent-dispatch', 'POST'],
    ['/login', 'GET'],
    ['/dashboard', 'GET'],
  ])('%s %s is not IP-limited at the edge', async (path, method) => {
    await proxy(req(path, { method }));
    expect(limitIp).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After in seconds when the limit is hit', async () => {
    limitIp.mockResolvedValue({ success: false, retryAfterMs: 60_000 });
    const res = await proxy(req('/api/tenants'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('rounds sub-second Retry-After up to 1', async () => {
    limitIp.mockResolvedValue({ success: false, retryAfterMs: 200 });
    const res = await proxy(req('/login', { method: 'POST' }));
    expect(res.headers.get('retry-after')).toBe('1');
  });
});

describe('proxy — Workers headers', () => {
  it('sets a base64 nonce that matches the CSP script-src', async () => {
    const res = await proxy(req('/login'));
    const nonce = res.headers.get('x-nonce');
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(nonce!)).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
  });

  it('allows the R2 host in connect-src and img-src instead of Tigris', async () => {
    const csp = (await proxy(req('/login'))).headers.get('content-security-policy')!;
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
    expect(csp).not.toContain('tigris');
  });

  it('allows blob: images so upload previews render', async () => {
    const csp = (await proxy(req('/login'))).headers.get('content-security-policy')!;
    expect(csp).toMatch(/img-src [^;]*blob:/);
  });
});
