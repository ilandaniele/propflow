/**
 * Meta X-Hub-Signature-256 validator.
 * Used by POST /api/whatsapp/webhook when WHATSAPP_PROVIDER=meta.
 * Kept separate from signature.ts (which handles the mock path).
 *
 * Security (ASVS L2):
 * - timingSafeEqual with equal-length-buffer guard prevents timing attacks.
 * - Returns false (not throw) so the webhook route can return 401 without leaking details.
 * - Secret (META_APP_SECRET) must NEVER appear in logs — only the result is returned.
 */

import crypto from 'crypto';

/**
 * Verify an X-Hub-Signature-256 header from Meta.
 *
 * @param rawBody  Raw request body Buffer (must be read BEFORE any JSON.parse)
 * @param header   Header value, e.g. "sha256=abc123..." (null returns false)
 * @param secret   META_APP_SECRET value
 * @returns true if signature is valid, false otherwise
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | null,
  secret: string
): boolean {
  if (!header || !secret) return false;

  // Extract hex digest from "sha256=<hex>"
  const eqIdx = header.indexOf('=');
  if (eqIdx === -1) return false;
  const algo = header.slice(0, eqIdx);
  const hex  = header.slice(eqIdx + 1);

  if (algo !== 'sha256' || !hex) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(hex, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    // timingSafeEqual requires equal-length buffers
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
