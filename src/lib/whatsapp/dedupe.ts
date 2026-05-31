/**
 * Image deduplication helpers.
 * Computes SHA-256 of image bytes for duplicate detection in payment_receipts.
 */

import crypto from 'crypto';

/**
 * Compute SHA-256 hex digest of a Buffer.
 */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute SHA-256 hex digest from a base64-encoded string.
 */
export function sha256FromBase64(base64: string): string {
  return sha256Hex(Buffer.from(base64, 'base64'));
}
