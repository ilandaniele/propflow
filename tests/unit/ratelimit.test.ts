import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/ratelimit';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://example.com', { headers });
}

describe('getClientIp', () => {
  it('prefers the fly-client-ip header when present', () => {
    const req = makeRequest({
      'fly-client-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8, 9.10.11.12',
      'x-real-ip': '13.14.15.16',
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the LAST entry of x-forwarded-for (Fly-appended peer IP)', () => {
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

  it('falls back to x-real-ip when no fly-client-ip or x-forwarded-for', () => {
    const req = makeRequest({ 'x-real-ip': '13.14.15.16' });
    expect(getClientIp(req)).toBe('13.14.15.16');
  });

  it('returns "anonymous" when no relevant headers are present', () => {
    const req = makeRequest({});
    expect(getClientIp(req)).toBe('anonymous');
  });
});
