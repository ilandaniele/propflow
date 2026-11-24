import { describe, it, expect } from 'vitest';
import { RemoveStaffMemberSchema, StaffMemberSchema } from '@/lib/staff/schemas';

describe('StaffMemberSchema', () => {
  it('accepts a minimal member and drops empty optional fields', () => {
    const parsed = StaffMemberSchema.parse({ full_name: ' Ana ', position: 'Portera', property_id: '', shift: '', phone: '  ', document_number: '' });
    expect(parsed).toEqual({ full_name: 'Ana', position: 'Portera' });
  });

  it('keeps optional fields when provided', () => {
    const id = crypto.randomUUID();
    const parsed = StaffMemberSchema.parse({ full_name: 'Ana', position: 'Portera', property_id: id, shift: 'Noche', phone: '999', document_number: '123' });
    expect(parsed).toMatchObject({ property_id: id, shift: 'Noche', phone: '999', document_number: '123' });
  });

  it('rejects missing name or position', () => {
    expect(StaffMemberSchema.safeParse({ full_name: '', position: 'Portera' }).success).toBe(false);
    expect(StaffMemberSchema.safeParse({ full_name: 'Ana', position: ' ' }).success).toBe(false);
  });

  it('rejects an invalid property id and oversized fields', () => {
    expect(StaffMemberSchema.safeParse({ full_name: 'Ana', position: 'P', property_id: 'nope' }).success).toBe(false);
    expect(StaffMemberSchema.safeParse({ full_name: 'Ana', position: 'P', phone: '1'.repeat(31) }).success).toBe(false);
  });
});

describe('RemoveStaffMemberSchema', () => {
  it('requires a guid', () => {
    expect(RemoveStaffMemberSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(RemoveStaffMemberSchema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
  });
});
