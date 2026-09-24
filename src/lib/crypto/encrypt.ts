import crypto from 'crypto';
import { assertServerEnv } from '@/lib/env';

/**
 * AES-256-GCM encryption for secrets at rest (Google Calendar refresh tokens,
 * and any other per-org credential we must be able to read back).
 * Output format: base64(iv [12 bytes] || authTag [16 bytes] || ciphertext).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = assertServerEnv('TOKEN_ENCRYPTION_KEY', 'token encryption');
  // Accept either a 64-char hex string or a base64 string that decodes to 32 bytes.
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('[crypto/encrypt] TOKEN_ENCRYPTION_KEY must decode to 32 bytes (hex or base64)');
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_LENGTH + 16) {
    throw new Error('[crypto/encrypt] payload too short to be valid');
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
