import { describe, it, expect } from 'vitest';
import { clientIpFromHeaders, getClientIp } from '@/lib/ratelimit';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://example.com', { headers });
}

describe('getClientIp', () => {
  it('prefers the cf-connecting-ip header when present', () => {
    const req = makeRequest({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8, 9.10.11.12',
      'x-real-ip': '13.14.15.16',
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the LAST entry of x-forwarded-for (proxy-appended peer IP)', () => {
    const req = makeRequest({
      'x-forwarded-for': '5.6.7.8, 9.10.11.12',
    });
    expect(getClientIp(req)).toBe('9.10.11.12');
  });

  it('trims whitespace around the last x-forwarded-for entry', () => {
    const req = makeRequest({
      'x-forwarded-for': '5.6.7.8,   9.10.11.12  ',
    });
    expect(getClientIp(req)).toBe('9.10.11.12');
  });

  it('falls back to x-real-ip when no cf-connecting-ip or x-forwarded-for', () => {
    const req = makeRequest({ 'x-real-ip': '13.14.15.16' });
    expect(getClientIp(req)).toBe('13.14.15.16');
  });

  it('returns "anonymous" when no relevant headers are present', () => {
    const req = makeRequest({});
    expect(getClientIp(req)).toBe('anonymous');
  });

  it('ignores the legacy fly-client-ip header', () => {
    const req = makeRequest({ 'fly-client-ip': '1.2.3.4', 'x-real-ip': '13.14.15.16' });
    expect(getClientIp(req)).toBe('13.14.15.16');
  });
});

describe('clientIpFromHeaders', () => {
  it('applies the same precedence as getClientIp to a bare Headers object', () => {
    const h = new Headers({ 'cf-connecting-ip': ' 1.2.3.4 ', 'x-forwarded-for': '5.6.7.8' });
    expect(clientIpFromHeaders(h)).toBe('1.2.3.4');
  });
});
