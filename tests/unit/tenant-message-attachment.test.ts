import { describe, it, expect } from 'vitest';
import { readMessageAttachment } from '@/lib/messages/attachment';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%test');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('readMessageAttachment', () => {
  it('treats a missing or empty file input as no attachment', async () => {
    expect(await readMessageAttachment(null)).toEqual({ ok: true, attachment: null });
    expect(await readMessageAttachment(new File([], '', { type: 'application/octet-stream' }))).toEqual({ ok: true, attachment: null });
    expect(await readMessageAttachment('not-a-file')).toEqual({ ok: true, attachment: null });
  });

  it('accepts a PDF whose bytes match the declared type', async () => {
    const result = await readMessageAttachment(new File([PDF_BYTES], 'lease.pdf', { type: 'application/pdf' }));
    expect(result.ok).toBe(true);
    if (!result.ok || !result.attachment) throw new Error('expected attachment');
    expect(result.attachment).toMatchObject({ name: 'lease.pdf', mime: 'application/pdf', size: PDF_BYTES.byteLength });
    expect(result.attachment.buffer.byteLength).toBe(PDF_BYTES.byteLength);
  });

  it('strips path separators and control characters from the display name', async () => {
    const result = await readMessageAttachment(new File([PNG_BYTES], '../../etc/\u0007photo.png', { type: 'image/png' }));
    if (!result.ok || !result.attachment) throw new Error('expected attachment');
    expect(result.attachment.name).not.toContain('/');
    expect(result.attachment.name).not.toContain('\u0007');
  });

  it('rejects disallowed types, spoofed content and oversize files', async () => {
    expect((await readMessageAttachment(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).ok).toBe(false);
    expect((await readMessageAttachment(new File(['<html>'], 'fake.pdf', { type: 'application/pdf' }))).ok).toBe(false);
    expect((await readMessageAttachment(new File([PDF_BYTES], 'fake.png', { type: 'image/png' }))).ok).toBe(false);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PDF_BYTES);
    expect((await readMessageAttachment(new File([big], 'big.pdf', { type: 'application/pdf' }))).ok).toBe(false);
  });
});
