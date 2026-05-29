import { describe, it, expect } from 'vitest';
import { CreateTenantSchema } from '@/lib/schemas/tenant';
import { CreateContractSchema } from '@/lib/schemas/contract';
import { RecordPaymentSchema } from '@/lib/schemas/payment';
import { CreateIncidentSchema, PhotoUploadSchema } from '@/lib/schemas/incident';

describe('CreateTenantSchema', () => {
  it('accepts a valid tenant', () => {
    const result = CreateTenantSchema.safeParse({ full_name: 'Jane Smith', email: 'jane@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = CreateTenantSchema.safeParse({ full_name: 'Jane', email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('email');
    }
  });

  it('rejects missing full_name', () => {
    const result = CreateTenantSchema.safeParse({ email: 'x@x.com' });
    expect(result.success).toBe(false);
  });

  it('accepts tenant without email', () => {
    const result = CreateTenantSchema.safeParse({ full_name: 'No Email Tenant' });
    expect(result.success).toBe(true);
  });
});

describe('CreateContractSchema', () => {
  const validContract = {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    unit_id: '00000000-0000-0000-0000-000000000002',
    start_date: '2025-01-01',
    end_date: '2026-01-01',
    monthly_rent: '1500',
  };

  it('accepts a valid contract', () => {
    const result = CreateContractSchema.safeParse(validContract);
    expect(result.success).toBe(true);
  });

  it('rejects end_date before start_date', () => {
    const result = CreateContractSchema.safeParse({
      ...validContract,
      start_date: '2026-01-01',
      end_date: '2025-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('end_date');
    }
  });

  it('rejects equal start and end dates', () => {
    const result = CreateContractSchema.safeParse({
      ...validContract,
      start_date: '2025-06-01',
      end_date: '2025-06-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative monthly_rent', () => {
    const result = CreateContractSchema.safeParse({ ...validContract, monthly_rent: '-100' });
    expect(result.success).toBe(false);
  });
});

describe('RecordPaymentSchema', () => {
  const validPayment = {
    contract_id: '00000000-0000-0000-0000-000000000001',
    amount: '1500',
    paid_at: '2025-06-01',
    method: 'transfer',
  };

  it('accepts a valid payment', () => {
    expect(RecordPaymentSchema.safeParse(validPayment).success).toBe(true);
  });

  it('rejects zero amount', () => {
    expect(RecordPaymentSchema.safeParse({ ...validPayment, amount: '0' }).success).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(RecordPaymentSchema.safeParse({ ...validPayment, amount: '-50' }).success).toBe(false);
  });

  it('rejects invalid method', () => {
    expect(RecordPaymentSchema.safeParse({ ...validPayment, method: 'bitcoin' }).success).toBe(false);
  });
});

describe('CreateIncidentSchema', () => {
  const valid = {
    title: 'Broken window',
    description: 'The window in the bedroom is cracked',
    category: 'structural',
    priority: 'high',
  };

  it('accepts a valid incident', () => {
    expect(CreateIncidentSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = CreateIncidentSchema.safeParse({ ...valid, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = CreateIncidentSchema.safeParse({ ...valid, category: 'broken' });
    expect(result.success).toBe(false);
  });
});

describe('PhotoUploadSchema', () => {
  it('accepts a valid image', () => {
    const result = PhotoUploadSchema.safeParse({
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024 * 1024, // 1 MB
    });
    expect(result.success).toBe(true);
  });

  it('rejects oversized image (> 5 MB)', () => {
    const result = PhotoUploadSchema.safeParse({
      fileName: 'big.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 6 * 1024 * 1024, // 6 MB
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid MIME type', () => {
    const result = PhotoUploadSchema.safeParse({
      fileName: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects exactly 5 MB + 1 byte', () => {
    const result = PhotoUploadSchema.safeParse({
      fileName: 'big.png',
      mimeType: 'image/png',
      sizeBytes: 5 * 1024 * 1024 + 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 5 MB', () => {
    const result = PhotoUploadSchema.safeParse({
      fileName: 'max.webp',
      mimeType: 'image/webp',
      sizeBytes: 5 * 1024 * 1024,
    });
    expect(result.success).toBe(true);
  });
});
