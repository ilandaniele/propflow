import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

describe('proxy — /pay links are public', () => {
  it('serves /pay/<token> without a login redirect and with security headers', async () => {
    const res = await proxy(new NextRequest(new URL(`/pay/${'a'.repeat(64)}`, 'http://localhost:3000')));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });
});
