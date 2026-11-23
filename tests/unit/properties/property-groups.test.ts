import { describe, it, expect } from 'vitest';
import { sumComparisons } from '@/lib/property-groups/queries';
import { CreatePropertyGroupSchema } from '@/lib/property-groups/schemas';

const row = (id: string, over: Partial<Parameters<typeof sumComparisons>[0][number]> = {}) => ({
  id, name: id, totalUnits: 0, occupiedUnits: 0, occupancyPct: 0, contractedRent: 0,
  collected: 0, expenses: 0, net: 0, openIncidents: 0, ...over,
});

describe('sumComparisons', () => {
  it('sums metrics and recomputes occupancy and net', () => {
    const totals = sumComparisons([
      row('a', { totalUnits: 3, occupiedUnits: 3, contractedRent: 900, collected: 1000, expenses: 100, openIncidents: 1 }),
      row('b', { totalUnits: 1, occupiedUnits: 0, collected: 0, expenses: 50.5, openIncidents: 2 }),
    ]);
    expect(totals).toEqual({
      totalUnits: 4, occupiedUnits: 3, occupancyPct: 75, contractedRent: 900,
      collected: 1000, expenses: 150.5, net: 849.5, openIncidents: 3,
    });
  });

  it('returns zeros for an empty group', () => {
    expect(sumComparisons([]).occupancyPct).toBe(0);
  });
});

describe('CreatePropertyGroupSchema', () => {
  const id = '00000000-0000-4000-8000-000000000000';

  it('trims the name and requires at least one property', () => {
    expect(CreatePropertyGroupSchema.parse({ name: ' Miraflores ', property_ids: [id] }).name).toBe('Miraflores');
    expect(CreatePropertyGroupSchema.safeParse({ name: 'X', property_ids: [] }).success).toBe(false);
    expect(CreatePropertyGroupSchema.safeParse({ name: ' ', property_ids: [id] }).success).toBe(false);
    expect(CreatePropertyGroupSchema.safeParse({ name: 'X', property_ids: ['nope'] }).success).toBe(false);
  });
});
