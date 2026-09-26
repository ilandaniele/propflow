import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt } from '@/lib/crypto/encrypt';

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

describe('crypto/encrypt', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it('round-trips a plaintext string', () => {
    const plaintext = 'ya29.a0AfH6SMB...refresh-token-secret';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
  });

  it('throws when the auth tag has been tampered with', () => {
    const ciphertext = encrypt('secret');
    const raw = Buffer.from(ciphertext, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip a byte in the ciphertext/tag region
    expect(() => decrypt(raw.toString('base64'))).toThrow();
  });

  it('accepts a base64-encoded 32-byte key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const ciphertext = encrypt('hello');
    expect(decrypt(ciphertext)).toBe('hello');
  });

  it('throws a clear error when TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
