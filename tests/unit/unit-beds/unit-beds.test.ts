import { describe, it, expect } from 'vitest';
import { rollupBeds } from '@/lib/unit-beds/rollup';
import { AssignUnitBedSchema, CreateUnitBedSchema } from '@/lib/unit-beds/schemas';

describe('rollupBeds', () => {
  it('returns zeros for a unit with no beds', () => {
    expect(rollupBeds([])).toEqual({ totalBeds: 0, occupiedBeds: 0, potentialRent: 0, occupiedRent: 0, occupancyPct: 0 });
  });

  it('sums rent up to the unit and splits occupied rent', () => {
    const rollup = rollupBeds([
      { monthlyRent: '400.00', tenantId: 't1' },
      { monthlyRent: '350.50', tenantId: null },
      { monthlyRent: null, tenantId: 't2' },
    ]);
    expect(rollup).toEqual({ totalBeds: 3, occupiedBeds: 2, potentialRent: 750.5, occupiedRent: 400, occupancyPct: 67 });
  });
});

describe('CreateUnitBedSchema', () => {
  const unitId = crypto.randomUUID();

  it('treats an empty rent as missing', () => {
    const parsed = CreateUnitBedSchema.parse({ unit_id: unitId, label: ' Cama A ', monthly_rent: '' });
    expect(parsed).toEqual({ unit_id: unitId, label: 'Cama A', monthly_rent: undefined });
  });

  it('rejects negative rent and blank labels', () => {
    expect(CreateUnitBedSchema.safeParse({ unit_id: unitId, label: 'A', monthly_rent: '-1' }).success).toBe(false);
    expect(CreateUnitBedSchema.safeParse({ unit_id: unitId, label: '  ' }).success).toBe(false);
  });
});

describe('AssignUnitBedSchema', () => {
  it('maps an empty tenant to null (vacate)', () => {
    const id = crypto.randomUUID();
    expect(AssignUnitBedSchema.parse({ id, tenant_id: '' })).toEqual({ id, tenant_id: null });
  });
});
