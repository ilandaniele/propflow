import { describe, it, expect } from 'vitest';
import { ConvertLeadSchema } from '@/lib/schemas/lead-conversion';

const valid = {
  lead_id: '11111111-1111-4111-8111-111111111111',
  full_name: 'Ana Pérez',
  email: '',
  phone: '',
  unit_id: '22222222-2222-4222-8222-222222222222',
  start_date: '2026-12-01',
  end_date: '2027-12-01',
  monthly_rent: '1500',
  deposit: '',
};

describe('ConvertLeadSchema', () => {
  it('accepts a valid form and coerces rent', () => {
    const parsed = ConvertLeadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.monthly_rent).toBe(1500);
    expect(parsed.data?.deposit).toBe('');
  });

  it('coerces a filled deposit', () => {
    expect(ConvertLeadSchema.parse({ ...valid, deposit: '3000' }).deposit).toBe(3000);
  });

  it('rejects an end date not after the start', () => {
    const parsed = ConvertLeadSchema.safeParse({ ...valid, end_date: '2026-12-01' });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-positive rent and blank names', () => {
    expect(ConvertLeadSchema.safeParse({ ...valid, monthly_rent: '0' }).success).toBe(false);
    expect(ConvertLeadSchema.safeParse({ ...valid, full_name: '   ' }).success).toBe(false);
  });
});
