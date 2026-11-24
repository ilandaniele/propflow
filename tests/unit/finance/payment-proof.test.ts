import { describe, it, expect } from 'vitest';
import {
  PAYMENT_PROOF_MAX_BYTES,
  buildPaymentProofPath,
  validatePaymentProof,
} from '@/lib/finance/payment-proof';
import { isSafeOrgScopedPath } from '@/lib/storage/path';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const PDF = Buffer.from('%PDF-1.7\n', 'latin1');
const GIF = Buffer.from('GIF89a\0\0\0\0\0\0', 'latin1');

describe('validatePaymentProof', () => {
  it.each([
    [JPEG, 'image/jpeg'],
    [PNG, 'image/png'],
    [WEBP, 'image/webp'],
    [PDF, 'application/pdf'],
  ])('accepts content matching its declared type (%#)', (buffer, mime) => {
    expect(validatePaymentProof(buffer, mime)).toEqual({ ok: true, mime });
  });

  it('rejects a declared type that does not match the magic bytes', () => {
    expect(validatePaymentProof(PDF, 'image/png')).toEqual({ ok: false, error: 'invalid_type' });
    expect(validatePaymentProof(JPEG, 'application/pdf')).toEqual({ ok: false, error: 'invalid_type' });
  });

  it('rejects types outside the allowlist even when sniffable', () => {
    expect(validatePaymentProof(GIF, 'image/gif')).toEqual({ ok: false, error: 'invalid_type' });
  });

  it('rejects unknown content and HTML disguised as an image', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'latin1');
    expect(validatePaymentProof(html, 'image/jpeg')).toEqual({ ok: false, error: 'invalid_type' });
  });

  it('rejects an empty file', () => {
    expect(validatePaymentProof(Buffer.alloc(0), 'image/jpeg')).toEqual({ ok: false, error: 'empty' });
  });

  it('rejects files over 5 MB and accepts exactly 5 MB', () => {
    const exact = Buffer.concat([PDF, Buffer.alloc(PAYMENT_PROOF_MAX_BYTES - PDF.length)]);
    expect(validatePaymentProof(exact, 'application/pdf').ok).toBe(true);
    const over = Buffer.concat([exact, Buffer.alloc(1)]);
    expect(validatePaymentProof(over, 'application/pdf')).toEqual({ ok: false, error: 'too_large' });
  });
});

describe('buildPaymentProofPath', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const contractId = '22222222-2222-4222-8222-222222222222';

  it('builds an org-scoped key with the extension of the sniffed type', () => {
    const pdfPath = buildPaymentProofPath(orgId, contractId, 'application/pdf');
    expect(pdfPath).toMatch(new RegExp(`^${orgId}/${contractId}/[0-9a-f-]{36}\\.pdf$`));
    expect(isSafeOrgScopedPath(pdfPath, orgId)).toBe(true);
    expect(buildPaymentProofPath(orgId, contractId, 'image/webp')).toMatch(/\.webp$/);
  });
});
