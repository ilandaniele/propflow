/**
 * Unit tests for verifyMetaSignature (src/lib/whatsapp/meta-signature.ts).
 *
 * Covers: valid HMAC, tampered body, missing header, wrong algorithm prefix,
 * constant-time comparison path (timingSafeEqual), length-mismatch guard.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyMetaSignature } from '@/lib/whatsapp/meta-signature';

const SECRET = 'meta-app-secret-for-tests';

function makeSignature(body: Buffer, secret = SECRET): string {
  const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

describe('verifyMetaSignature', () => {
  it('returns true for a valid sha256 HMAC over the raw body', () => {
    const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
    const sig  = makeSignature(body);
    expect(verifyMetaSignature(body, sig, SECRET)).toBe(true);
  });

  it('returns false when the body has been tampered after signing', () => {
    const originalBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const tamperedBody = Buffer.from('{"object":"TAMPERED"}');
    const sig          = makeSignature(originalBody);
    expect(verifyMetaSignature(tamperedBody, sig, SECRET)).toBe(false);
  });

  it('returns false for null header', () => {
    const body = Buffer.from('test body');
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
  });

  it('returns false for empty string header', () => {
    const body = Buffer.from('test body');
    expect(verifyMetaSignature(body, '', SECRET)).toBe(false);
  });

  it('returns false when header has no "=" separator', () => {
    const body = Buffer.from('test body');
    expect(verifyMetaSignature(body, 'sha256abcdefg', SECRET)).toBe(false);
  });

  it('returns false for wrong algorithm prefix (md5= instead of sha256=)', () => {
    const body = Buffer.from('test body');
    const md5hex = crypto.createHmac('md5', SECRET).update(body).digest('hex');
    expect(verifyMetaSignature(body, `md5=${md5hex}`, SECRET)).toBe(false);
  });

  it('returns false for completely wrong signature value (same length)', () => {
    const body = Buffer.from('{"valid":"payload"}');
    // 64 zeroes — correct length for a hex-encoded SHA-256 digest but wrong value
    const wrongSig = `sha256=${'0'.repeat(64)}`;
    expect(verifyMetaSignature(body, wrongSig, SECRET)).toBe(false);
  });

  it('returns false when the hex is truncated (length mismatch guard)', () => {
    const body = Buffer.from('test body');
    // 30 hex chars — shorter than the 64-char SHA-256 hex
    expect(verifyMetaSignature(body, `sha256=${'a'.repeat(30)}`, SECRET)).toBe(false);
  });

  it('returns false when secret is empty string', () => {
    const body = Buffer.from('test body');
    const sig  = makeSignature(body);
    // Empty secret — verifyMetaSignature guards !secret
    expect(verifyMetaSignature(body, sig, '')).toBe(false);
  });

  it('uses timingSafeEqual: different-length buffers still return false (no throw)', () => {
    const body       = Buffer.from('test');
    // Provide a sig that will produce a hex string of different byte-length after Buffer.from(hex, 'hex')
    // For SHA-256, the expected HMAC is always 32 bytes; we manufacture an odd-length hex string.
    const oddHex     = 'a'.repeat(63);  // 63 hex chars → 31.5 bytes → Buffer.from truncates to 31 bytes
    expect(() => verifyMetaSignature(body, `sha256=${oddHex}`, SECRET)).not.toThrow();
    expect(verifyMetaSignature(body, `sha256=${oddHex}`, SECRET)).toBe(false);
  });

  it('is deterministic: same inputs always return the same result', () => {
    const body = Buffer.from('consistent payload');
    const sig  = makeSignature(body);
    for (let i = 0; i < 5; i++) {
      expect(verifyMetaSignature(body, sig, SECRET)).toBe(true);
    }
  });
});
