import { MAX_IMAGE_SIZE_BYTES } from '@/lib/storage';
import { buildCopyPath, sniffCopyMime } from '@/lib/airtable-final/attachments';

export const PAYMENT_PROOF_BUCKET = 'receipts';
export const PAYMENT_PROOF_MAX_BYTES = MAX_IMAGE_SIZE_BYTES;
export const PAYMENT_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export type PaymentProofMime = (typeof PAYMENT_PROOF_MIME_TYPES)[number];
export type PaymentProofError = 'empty' | 'too_large' | 'invalid_type';
export type PaymentProofCheck = { ok: true; mime: PaymentProofMime } | { ok: false; error: PaymentProofError };

function isProofMime(mime: string | null): mime is PaymentProofMime {
  return (PAYMENT_PROOF_MIME_TYPES as readonly (string | null)[]).includes(mime);
}

/** Size cap plus magic-byte sniff; the declared MIME must match the real content. */
export function validatePaymentProof(buffer: Buffer, declaredMime: string): PaymentProofCheck {
  if (buffer.byteLength === 0) return { ok: false, error: 'empty' };
  if (buffer.byteLength > PAYMENT_PROOF_MAX_BYTES) return { ok: false, error: 'too_large' };
  const sniffed = sniffCopyMime(buffer);
  if (!isProofMime(sniffed) || sniffed !== declaredMime) return { ok: false, error: 'invalid_type' };
  return { ok: true, mime: sniffed };
}

/** `{orgId}/{contractId}/{uuid}.{ext}`, the shape `isSafeOrgScopedPath` accepts. */
export function buildPaymentProofPath(orgId: string, contractId: string, mime: PaymentProofMime): string {
  return buildCopyPath(orgId, contractId, mime);
}
