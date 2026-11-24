import { describe, it, expect } from 'vitest';
import { SupplierSchema, UpdateAssignmentSchema } from '@/lib/schemas/suppliers';

describe('supplier schemas', () => {
  it('normalizes empty optional fields to null', () => {
    const parsed = SupplierSchema.parse({ name: '  Gasfitero Luis ', trade: 'plumbing', phone: '', email: '', notes: '' });
    expect(parsed).toEqual({ name: 'Gasfitero Luis', trade: 'plumbing', phone: null, email: null, notes: null });
  });

  it('rejects unknown trade and bad email', () => {
    expect(SupplierSchema.safeParse({ name: 'X', trade: 'astronaut' }).success).toBe(false);
    expect(SupplierSchema.safeParse({ name: 'X', trade: 'general', email: 'nope' }).success).toBe(false);
  });

  it('formats amounts to two decimals and rejects negatives or text', () => {
    const parsed = UpdateAssignmentSchema.parse({ incident_id: 'i', status: 'quoted', quote_amount: '150.5', final_cost: '' });
    expect(parsed).toMatchObject({ quote_amount: '150.50', final_cost: null });
    expect(UpdateAssignmentSchema.safeParse({ incident_id: 'i', status: 'quoted', quote_amount: '-1' }).success).toBe(false);
    expect(UpdateAssignmentSchema.safeParse({ incident_id: 'i', status: 'quoted', quote_amount: 'abc' }).success).toBe(false);
  });
});
