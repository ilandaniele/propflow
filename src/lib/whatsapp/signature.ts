/**
 * HMAC-SHA256 webhook signature validator.
 * Used by POST /api/whatsapp/webhook.
 * Uses crypto.timingSafeEqual to prevent timing attacks (ASVS L2).
 */

import crypto from 'crypto';

/**
 * Validate an HMAC-SHA256 webhook signature.
 * @param rawBody  Raw request body Buffer
 * @param signature  Header value in format "sha256=<hex>"
 * @param secret  WHATSAPP_WEBHOOK_SECRET
 */
export function validateHmacSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const [algo, hex] = signature.split('=');
  if (algo !== 'sha256' || !hex) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Buffers must be same length for timingSafeEqual
  try {
    const sigBuf = Buffer.from(hex, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
