import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import nextConfig from '../../../next.config';

function req(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

describe('proxy — widget framing (Agent Phase 7)', () => {
  it('/widget/pk_x gets no X-Frame-Options and no CSP from the proxy — the route sets its own', async () => {
    const res = await proxy(req('/widget/pk_x'));
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('/widget.js also gets no security headers from the proxy', async () => {
    const res = await proxy(req('/widget.js'));
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it("/p/acme gets X-Frame-Options: DENY and frame-ancestors 'none'", async () => {
    const res = await proxy(req('/p/acme'));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it("the global CSP's frame-src includes 'self' (so /p can host the widget iframe)", async () => {
    const res = await proxy(req('/p/acme'));
    expect(res.headers.get('content-security-policy')).toContain("frame-src 'self' https://accounts.google.com");
  });
});

describe('next.config headers() — widget path exclusion', () => {
  it('excludes /widget.js and /widget/* from the catch-all X-Frame-Options rule', async () => {
    const rules = await nextConfig.headers!();
    const catchAll = rules.find((r) => r.source.includes('(?!widget'));
    expect(catchAll).toBeDefined();
    expect(catchAll!.headers.some((h) => h.key === 'X-Frame-Options')).toBe(true);

    const widgetJsRule = rules.find((r) => r.source === '/widget.js');
    const widgetFrameRule = rules.find((r) => r.source.startsWith('/widget/'));
    expect(widgetJsRule).toBeDefined();
    expect(widgetFrameRule).toBeDefined();
    expect(widgetJsRule!.headers.some((h) => h.key === 'X-Frame-Options')).toBe(false);
    expect(widgetFrameRule!.headers.some((h) => h.key === 'X-Frame-Options')).toBe(false);
    expect(widgetJsRule!.headers.some((h) => h.key === 'Cross-Origin-Opener-Policy')).toBe(false);
    expect(widgetFrameRule!.headers.some((h) => h.key === 'Cross-Origin-Opener-Policy')).toBe(false);
  });
});
