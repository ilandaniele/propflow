import { describe, it, expect } from 'vitest';
import {
  ChangeUtilityHolderSchema,
  CreateUtilityContractSchema,
  UpdateUtilityContractSchema,
} from '@/lib/utility-contracts/schemas';

const propertyId = crypto.randomUUID();

describe('CreateUtilityContractSchema', () => {
  it('trims text and maps blank optional fields to undefined', () => {
    const parsed = CreateUtilityContractSchema.parse({
      property_id: propertyId,
      unit_id: '',
      utility_type: 'luz',
      provider: ' Luz del Sur ',
      supply_number: '',
      monthly_estimate: '',
      start_date: '',
      notes: '',
      holder_kind: 'owner',
      holder_name: ' Ana Pérez ',
    });
    expect(parsed).toEqual({
      property_id: propertyId,
      unit_id: undefined,
      utility_type: 'luz',
      provider: 'Luz del Sur',
      supply_number: undefined,
      monthly_estimate: undefined,
      start_date: undefined,
      notes: undefined,
      holder_kind: 'owner',
      holder_name: 'Ana Pérez',
    });
  });

  it('coerces the monthly estimate', () => {
    const parsed = CreateUtilityContractSchema.parse({
      property_id: propertyId, utility_type: 'agua', provider: 'Sedapal', holder_kind: 'tenant', holder_name: 'X', monthly_estimate: '85.5',
    });
    expect(parsed.monthly_estimate).toBe(85.5);
  });

  it('rejects unknown types, holder kinds, negative estimates and bad dates', () => {
    const base = { property_id: propertyId, utility_type: 'gas', provider: 'Calidda', holder_kind: 'owner', holder_name: 'X' };
    expect(CreateUtilityContractSchema.safeParse({ ...base, utility_type: 'cable' }).success).toBe(false);
    expect(CreateUtilityContractSchema.safeParse({ ...base, holder_kind: 'bank' }).success).toBe(false);
    expect(CreateUtilityContractSchema.safeParse({ ...base, monthly_estimate: '-1' }).success).toBe(false);
    expect(CreateUtilityContractSchema.safeParse({ ...base, start_date: '01/02/2026' }).success).toBe(false);
    expect(CreateUtilityContractSchema.safeParse({ ...base, provider: '  ' }).success).toBe(false);
  });
});

describe('UpdateUtilityContractSchema', () => {
  it('ignores holder fields (holder changes go through the change log)', () => {
    const id = crypto.randomUUID();
    const parsed = UpdateUtilityContractSchema.parse({ id, utility_type: 'internet', provider: 'Movistar', holder_name: 'Ignored' });
    expect(parsed).not.toHaveProperty('holder_name');
  });
});

describe('ChangeUtilityHolderSchema', () => {
  it('requires a date and a new holder name', () => {
    const id = crypto.randomUUID();
    expect(ChangeUtilityHolderSchema.safeParse({ id, holder_kind: 'tenant', holder_name: 'Juan' }).success).toBe(false);
    expect(ChangeUtilityHolderSchema.safeParse({ id, holder_kind: 'tenant', holder_name: '', changed_on: '2026-11-01' }).success).toBe(false);
    expect(ChangeUtilityHolderSchema.parse({ id, holder_kind: 'tenant', holder_name: 'Juan', changed_on: '2026-11-01', reason: '' }))
      .toEqual({ id, holder_kind: 'tenant', holder_name: 'Juan', changed_on: '2026-11-01', reason: undefined });
  });
});
