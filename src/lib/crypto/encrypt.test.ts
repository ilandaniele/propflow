import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from './encrypt';

// Test-only key (bytes 0x00..0x1f). Never a real secret.
const TEST_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const PLAINTEXT = 'ya29.test-refresh-token/ñ✓';
// Produced once with Node's node:crypto (aes-256-gcm, iv = 0x00..0x0b):
// base64(iv [12] || authTag [16] || ciphertext). Tokens already stored in the
// database use this layout, so it must keep decrypting after the Workers move.
const NODE_VECTOR = 'AAECAwQFBgcICQoLfJo3mGYmhK+3MMDU+t/jiz5j5CLrkado+Wzl7tebHR7r+/Nbmx4xU/vWBxmO';

function nodeDecrypt(payload: string, keyHex: string): string {
  const raw = Buffer.from(payload, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

describe('crypto/encrypt', () => {
  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decrypts a vector encrypted with node:crypto', () => {
    expect(decrypt(NODE_VECTOR)).toBe(PLAINTEXT);
  });

  it('produces ciphertext that node:crypto decrypts', () => {
    const payload = encrypt(PLAINTEXT);
    expect(Buffer.from(payload, 'base64').length).toBe(12 + 16 + Buffer.byteLength(PLAINTEXT, 'utf8'));
    expect(nodeDecrypt(payload, TEST_KEY_HEX)).toBe(PLAINTEXT);
  });

  it('uses a fresh iv per call', () => {
    expect(encrypt(PLAINTEXT)).not.toBe(encrypt(PLAINTEXT));
  });

  it('accepts a base64 key', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.from(TEST_KEY_HEX, 'hex').toString('base64'));
    expect(decrypt(NODE_VECTOR)).toBe(PLAINTEXT);
  });

  it('rejects a tampered payload', () => {
    const raw = Buffer.from(NODE_VECTOR, 'base64');
    raw[raw.length - 1] ^= 0x01;
    expect(() => decrypt(raw.toString('base64'))).toThrow();
  });

  it('rejects a payload shorter than iv + tag', () => {
    expect(() => decrypt(Buffer.alloc(27).toString('base64'))).toThrow(/too short/);
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'c2hvcnQ=');
    expect(() => encrypt(PLAINTEXT)).toThrow(/32 bytes/);
  });
});
