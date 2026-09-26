import { describe, it, expect } from 'vitest';
import { getAppOrigin, normalizeOrigin, buildFrameAncestors, isSameAppOrigin } from '@/lib/widget/origins';

// vitest.config.ts stubs NEXT_PUBLIC_SITE_URL to http://localhost:3000
describe('widget/origins', () => {
  describe('getAppOrigin', () => {
    it('derives the origin from NEXT_PUBLIC_SITE_URL', () => {
      expect(getAppOrigin()).toBe('http://localhost:3000');
    });
  });

  describe('normalizeOrigin', () => {
    it('accepts https origins', () => {
      expect(normalizeOrigin('https://example.com')).toBe('https://example.com');
    });

    it('rejects http except for localhost/127.0.0.1', () => {
      expect(normalizeOrigin('http://example.com')).toBeNull();
      expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
      expect(normalizeOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    });

    it('strips any path/query', () => {
      expect(normalizeOrigin('https://example.com/some/path?x=1')).toBe('https://example.com');
    });

    it('lowercases the host', () => {
      expect(normalizeOrigin('https://EXAMPLE.com')).toBe('https://example.com');
    });

    it('strips the default port', () => {
      expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
    });

    it('keeps a non-default port', () => {
      expect(normalizeOrigin('https://example.com:8443')).toBe('https://example.com:8443');
    });

    it('returns null for unparseable input', () => {
      expect(normalizeOrigin('not a url')).toBeNull();
      expect(normalizeOrigin('')).toBeNull();
    });

    it('rejects a hostname with a trailing dot', () => {
      expect(normalizeOrigin('https://example.com.')).toBeNull();
    });

    it('rejects an IPv6 literal hostname (brackets are not a valid hostname label)', () => {
      expect(normalizeOrigin('https://[::1]')).toBeNull();
    });

    it('rejects a hostname with an underscore or other invalid label characters', () => {
      expect(normalizeOrigin('https://ev_il.example.com')).toBeNull();
      expect(normalizeOrigin('https://exa mple.com')).toBeNull();
    });

    it('rejects a hostname with an empty label (double dot)', () => {
      expect(normalizeOrigin('https://example..com')).toBeNull();
    });

    it('still accepts plain localhost and dotted-quad 127.0.0.1', () => {
      expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
      expect(normalizeOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    });

    it('still accepts an ordinary multi-label https hostname', () => {
      expect(normalizeOrigin('https://widget.acme-realty.com')).toBe('https://widget.acme-realty.com');
    });
  });

  describe('buildFrameAncestors', () => {
    it("returns just 'self' for an empty list", () => {
      expect(buildFrameAncestors([])).toBe("frame-ancestors 'self'");
    });

    it('drops invalid origins and keeps valid ones', () => {
      expect(buildFrameAncestors(['https://a.com', 'not a url', 'http://b.com'])).toBe(
        "frame-ancestors 'self' https://a.com",
      );
    });
  });

  describe('isSameAppOrigin', () => {
    it('is true when the Origin header matches the app origin', () => {
      const req = new Request('http://localhost:3000/api/x', { headers: { origin: 'http://localhost:3000' } });
      expect(isSameAppOrigin(req)).toBe(true);
    });

    it('is false when the Origin header is a different origin', () => {
      const req = new Request('http://localhost:3000/api/x', { headers: { origin: 'https://evil.com' } });
      expect(isSameAppOrigin(req)).toBe(false);
    });

    it('falls back to Sec-Fetch-Site when there is no Origin header', () => {
      const same = new Request('http://localhost:3000/api/x', { headers: { 'sec-fetch-site': 'same-origin' } });
      expect(isSameAppOrigin(same)).toBe(true);

      const cross = new Request('http://localhost:3000/api/x', { headers: { 'sec-fetch-site': 'cross-site' } });
      expect(isSameAppOrigin(cross)).toBe(false);

      const none = new Request('http://localhost:3000/api/x');
      expect(isSameAppOrigin(none)).toBe(false);
    });
  });
});
