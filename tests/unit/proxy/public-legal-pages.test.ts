import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function req(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

describe('proxy — /privacidad and /terminos are public (item 4)', () => {
  it('/privacidad is served without a redirect to /login', async () => {
    const res = await proxy(req('/privacidad'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('/terminos is served without a redirect to /login', async () => {
    const res = await proxy(req('/terminos'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still applies the standard security headers to these public pages', async () => {
    const res = await proxy(req('/privacidad'));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });
});
