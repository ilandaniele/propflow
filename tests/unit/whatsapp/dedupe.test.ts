import { describe, it, expect } from 'vitest';
import { sha256Hex, sha256FromBase64 } from '@/lib/whatsapp/dedupe';

describe('sha256Hex', () => {
  it('returns consistent hex hash for same input', () => {
    const buf = Buffer.from('hello world');
    const h1 = sha256Hex(buf);
    const h2 = sha256Hex(buf);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(h1).toMatch(/^[0-9a-f]+$/);
  });

  it('returns different hashes for different inputs', () => {
    const h1 = sha256Hex(Buffer.from('image1'));
    const h2 = sha256Hex(Buffer.from('image2'));
    expect(h1).not.toBe(h2);
  });

  it('sha256FromBase64 matches sha256Hex of decoded buffer', () => {
    const original = 'test data for hashing';
    const b64 = Buffer.from(original).toString('base64');
    const fromBase64 = sha256FromBase64(b64);
    const fromBuffer = sha256Hex(Buffer.from(original));
    expect(fromBase64).toBe(fromBuffer);
  });
});
