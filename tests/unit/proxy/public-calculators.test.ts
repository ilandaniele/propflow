import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

describe('proxy — /calculadoras is public (#49)', () => {
  it('is served without a redirect to /login and keeps security headers', async () => {
    const res = await proxy(new NextRequest(new URL('/calculadoras', 'http://localhost:3000')));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
