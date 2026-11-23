import { describe, it, expect } from 'vitest';
import {
  isValidApplicationDocument,
  MAX_APPLICATION_DOCUMENT_BYTES,
  readDocumentUploads,
} from '@/lib/applications/documents';
import { RentalApplicationSchema } from '@/lib/schemas/rental-application';

const pdfBytes = Buffer.from('%PDF-1.7\n%test');

function pdfFile(name = 'ingresos.pdf'): File {
  return new File([pdfBytes], name, { type: 'application/pdf' });
}

describe('isValidApplicationDocument', () => {
  it('accepts a real PDF header', () => {
    expect(isValidApplicationDocument(pdfBytes, 'application/pdf')).toBe(true);
  });

  it('rejects a file declared as PDF without the magic bytes', () => {
    expect(isValidApplicationDocument(Buffer.from('<html>'), 'application/pdf')).toBe(false);
  });

  it('rejects an oversized PDF', () => {
    const big = Buffer.concat([pdfBytes, Buffer.alloc(MAX_APPLICATION_DOCUMENT_BYTES)]);
    expect(isValidApplicationDocument(big, 'application/pdf')).toBe(false);
  });

  it('rejects unsupported mime types', () => {
    expect(isValidApplicationDocument(pdfBytes, 'text/plain')).toBe(false);
  });
});

describe('readDocumentUploads', () => {
  it('returns uploads for valid files', async () => {
    const uploads = await readDocumentUploads([pdfFile()]);
    expect(uploads).toHaveLength(1);
    expect(uploads?.[0]).toMatchObject({ mime: 'application/pdf', name: 'ingresos.pdf' });
  });

  it('rejects more than three files', async () => {
    expect(await readDocumentUploads([pdfFile(), pdfFile(), pdfFile(), pdfFile()])).toBeNull();
  });

  it('rejects the batch when any file is invalid', async () => {
    const fake = new File(['nope'], 'x.pdf', { type: 'application/pdf' });
    expect(await readDocumentUploads([pdfFile(), fake])).toBeNull();
  });
});

describe('RentalApplicationSchema', () => {
  const valid = {
    full_name: 'Ana Pérez',
    email: 'ANA@Example.com',
    phone: '987654321',
    monthly_income: '5000',
    employment_type: 'employee',
    employment_months: '12',
    household_size: '2',
    privacy_accepted: 'on',
  };

  it('parses and normalizes a valid application', () => {
    const parsed = RentalApplicationSchema.parse(valid);
    expect(parsed.email).toBe('ana@example.com');
    expect(parsed.monthly_income).toBe(5000);
  });

  it('requires privacy acceptance', () => {
    const { privacy_accepted: _omit, ...rest } = valid;
    expect(RentalApplicationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an unknown employment type', () => {
    expect(RentalApplicationSchema.safeParse({ ...valid, employment_type: 'pirate' }).success).toBe(false);
  });
});
