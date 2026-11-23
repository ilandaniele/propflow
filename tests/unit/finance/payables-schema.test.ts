import { describe, it, expect } from 'vitest';
import {
  CreatePayableSchema,
  PayableFiltersSchema,
  RegisterPayablePaymentSchema,
} from '@/lib/schemas/payables';

const PAYABLE_ID = '11111111-1111-4111-8111-111111111111';

const validPayable = {
  supplier_name: 'Ferretería Lima',
  description: 'Pintura pasillos',
  document_ref: 'F001-123',
  amount: '1500.50',
  issued_on: '2026-11-01',
  due_on: '2026-11-30',
  property_id: '',
  category_id: '',
};

describe('CreatePayableSchema', () => {
  it('accepts a valid form, coerces amount and drops blank optional ids', () => {
    const parsed = CreatePayableSchema.parse(validPayable);
    expect(parsed.amount).toBe(1500.5);
    expect(parsed.property_id).toBeUndefined();
    expect(parsed.category_id).toBeUndefined();
  });

  it('rejects non-positive amounts and more than two decimals', () => {
    expect(CreatePayableSchema.safeParse({ ...validPayable, amount: '0' }).success).toBe(false);
    expect(CreatePayableSchema.safeParse({ ...validPayable, amount: '-5' }).success).toBe(false);
    expect(CreatePayableSchema.safeParse({ ...validPayable, amount: '10.005' }).success).toBe(false);
  });

  it('rejects a blank supplier and a due date before the issue date', () => {
    expect(CreatePayableSchema.safeParse({ ...validPayable, supplier_name: '  ' }).success).toBe(false);
    expect(CreatePayableSchema.safeParse({ ...validPayable, due_on: '2026-10-31' }).success).toBe(false);
  });

  it('rejects malformed dates and ids', () => {
    expect(CreatePayableSchema.safeParse({ ...validPayable, due_on: '30/11/2026' }).success).toBe(false);
    expect(CreatePayableSchema.safeParse({ ...validPayable, property_id: 'nope' }).success).toBe(false);
  });
});

describe('RegisterPayablePaymentSchema', () => {
  const validPayment = { payable_id: PAYABLE_ID, amount: '250', paid_on: '2026-11-20', note: '' };

  it('accepts a valid payment', () => {
    const parsed = RegisterPayablePaymentSchema.parse(validPayment);
    expect(parsed.amount).toBe(250);
    expect(parsed.note).toBeUndefined();
  });

  it('rejects zero amounts and a bad payable id', () => {
    expect(RegisterPayablePaymentSchema.safeParse({ ...validPayment, amount: '0' }).success).toBe(false);
    expect(RegisterPayablePaymentSchema.safeParse({ ...validPayment, payable_id: 'x' }).success).toBe(false);
  });
});

describe('PayableFiltersSchema', () => {
  it('defaults to page 1 with no filters', () => {
    expect(PayableFiltersSchema.parse({})).toEqual({ page: 1 });
  });

  it('keeps valid filters and discards invalid ones', () => {
    expect(PayableFiltersSchema.parse({ status: 'overdue', due_from: '2026-11-01', due_to: '2026-11-30', page: '3' }))
      .toEqual({ status: 'overdue', due_from: '2026-11-01', due_to: '2026-11-30', page: 3 });
    expect(PayableFiltersSchema.parse({ status: 'bogus', due_from: 'x', page: '-2' })).toEqual({ page: 1 });
  });
});
