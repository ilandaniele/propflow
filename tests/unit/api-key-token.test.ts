import { describe, it, expect } from 'vitest';
import { generateApiKey, parseBearerToken } from '@/lib/api-keys/token';
import { sha256 } from '@/lib/crypto/hash';
import { ApiPageSchema, toPage } from '@/lib/public-api/pagination';

describe('generateApiKey', () => {
  it('returns a pf_ token whose prefix and hash match', () => {
    const { token, prefix, keyHash } = generateApiKey();
    expect(token).toMatch(/^pf_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(`pf_${prefix}_`)).toBe(true);
    expect(keyHash).toBe(sha256(token));
  });

  it('never repeats a token', () => {
    expect(generateApiKey().token).not.toBe(generateApiKey().token);
  });
});

describe('parseBearerToken', () => {
  const { token } = generateApiKey();

  it('accepts a well-formed bearer token', () => {
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token);
    expect(parseBearerToken(`bearer ${token}`)).toBe(token);
  });

  it.each([null, '', token, `Basic ${token}`, 'Bearer pf_zzzzzzzz_short', `Bearer ${token} extra`])(
    'rejects %s',
    (header) => {
      expect(parseBearerToken(header)).toBeNull();
    },
  );
});

describe('public API pagination', () => {
  it('defaults to 50 and caps limit at 100', () => {
    expect(ApiPageSchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(ApiPageSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ApiPageSchema.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('trims the lookahead row and reports hasMore', () => {
    const page = { limit: 2, offset: 0 };
    expect(toPage([1, 2, 3], page)).toEqual({ data: [1, 2], pagination: { limit: 2, offset: 0, hasMore: true } });
    expect(toPage([1, 2], page).pagination.hasMore).toBe(false);
  });
});
