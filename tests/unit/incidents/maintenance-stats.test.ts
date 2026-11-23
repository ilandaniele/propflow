import { describe, it, expect } from 'vitest';
import { summarizeMaintenance } from '@/lib/incidents/stats';

const row = (overrides: Partial<Parameters<typeof summarizeMaintenance>[0][number]>) => ({
  propertyId: 'p1',
  propertyName: 'Casa',
  total: 0,
  open: 0,
  resolvedCount: 0,
  resolutionDaysSum: 0,
  ...overrides,
});

describe('summarizeMaintenance', () => {
  it('weights the global average by resolved incidents, not by property', () => {
    const stats = summarizeMaintenance(
      [
        row({ propertyId: 'a', total: 3, open: 0, resolvedCount: 3, resolutionDaysSum: 3 }),
        row({ propertyId: 'b', total: 1, open: 0, resolvedCount: 1, resolutionDaysSum: 9 }),
      ],
      [],
    );
    expect(stats.avgResolutionDays).toBe(3);
    expect(stats.byProperty.map((p) => p.avgResolutionDays)).toEqual([1, 9]);
  });

  it('returns null averages when nothing is resolved', () => {
    const stats = summarizeMaintenance([row({ total: 2, open: 2 })], []);
    expect(stats.avgResolutionDays).toBeNull();
    expect(stats.byProperty[0].avgResolutionDays).toBeNull();
    expect(stats.solved).toBe(0);
  });

  it('sorts properties and categories by volume and rounds to one decimal', () => {
    const stats = summarizeMaintenance(
      [
        row({ propertyId: 'small', total: 1, resolvedCount: 3, resolutionDaysSum: 1 }),
        row({ propertyId: 'big', total: 5, open: 2 }),
      ],
      [{ category: 'other', total: 1 }, { category: 'plumbing', total: 4 }],
    );
    expect(stats.byProperty.map((p) => p.propertyId)).toEqual(['big', 'small']);
    expect(stats.byProperty[1].avgResolutionDays).toBe(0.3);
    expect(stats.byCategory[0].category).toBe('plumbing');
    expect(stats).toMatchObject({ total: 6, open: 2, solved: 4 });
  });

  it('handles an org without incidents', () => {
    expect(summarizeMaintenance([], [])).toEqual({
      total: 0, open: 0, solved: 0, avgResolutionDays: null, byProperty: [], byCategory: [],
    });
  });
});
