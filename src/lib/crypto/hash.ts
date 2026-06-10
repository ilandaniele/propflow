import crypto from 'crypto';

/**
 * Returns the hex-encoded SHA-256 hash of the given UTF-8 string.
 * Used to hash invitation tokens before storing in DB — raw tokens are never persisted.
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
