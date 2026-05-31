import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateHmacSignature } from '@/lib/whatsapp/signature';

describe('validateHmacSignature', () => {
  const SECRET = 'test-webhook-secret-32bytes-xxxxx';

  function makeSignature(body: Buffer, secret: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  it('returns true for valid signature', () => {
    const body = Buffer.from('{"from":"+123","to":"+456"}');
    const sig = makeSignature(body, SECRET);
    expect(validateHmacSignature(body, sig, SECRET)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = Buffer.from('{"from":"+123","to":"+456"}');
    const sig = makeSignature(body, SECRET);
    const tamperedBody = Buffer.from('{"from":"+999","to":"+456"}');
    expect(validateHmacSignature(tamperedBody, sig, SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = Buffer.from('test');
    const sig = makeSignature(body, SECRET);
    expect(validateHmacSignature(body, sig, 'wrong-secret')).toBe(false);
  });

  it('returns false for empty signature', () => {
    const body = Buffer.from('test');
    expect(validateHmacSignature(body, '', SECRET)).toBe(false);
  });

  it('returns false for malformed signature (no sha256= prefix)', () => {
    const body = Buffer.from('test');
    expect(validateHmacSignature(body, 'notavalidsig', SECRET)).toBe(false);
  });

  it('returns false when secret is empty string', () => {
    const body = Buffer.from('test');
    const sig = makeSignature(body, SECRET);
    expect(validateHmacSignature(body, sig, '')).toBe(false);
  });
});
