import { describe, it, expect } from 'vitest';
import { buildOccupancyHistory } from '@/lib/finance/occupancy-history';

const units = [
  { id: 'u1', propertyId: 'p1', propertyName: 'Casa' },
  { id: 'u2', propertyId: 'p1', propertyName: 'Casa' },
  { id: 'u3', propertyId: 'p2', propertyName: 'Torre' },
];

describe('buildOccupancyHistory', () => {
  it('counts occupied days per month and merges overlapping stays', () => {
    const history = buildOccupancyHistory({
      units,
      stays: [
        { unitId: 'u1', start: '2025-06-01', end: null },
        { unitId: 'u2', start: '2026-02-15', end: '2026-03-14' },
        { unitId: 'u2', start: '2026-03-01', end: '2026-03-31' },
      ],
      year: 2026,
      today: '2026-12-31',
    });

    const casa = history.properties.find((property) => property.propertyId === 'p1')!;
    expect(casa.units).toBe(2);
    expect(casa.rates[0]).toBe(0.5);
    expect(casa.rates[1]).toBe(Math.round(((28 + 14) / 56) * 1000) / 1000);
    expect(casa.rates[2]).toBe(1);
    expect(casa.rates[3]).toBe(0.5);

    const torre = history.properties.find((property) => property.propertyId === 'p2')!;
    expect(torre.average).toBe(0);
    expect(history.months[2]).toEqual({ month: '2026-03', occupiedDays: 62, availableDays: 93, rate: 0.667 });
  });

  it('stops at today and leaves future months empty', () => {
    const history = buildOccupancyHistory({
      units: [units[0]],
      stays: [{ unitId: 'u1', start: '2026-01-01', end: null }],
      year: 2026,
      today: '2026-03-10',
    });
    expect(history.months[2]).toEqual({ month: '2026-03', occupiedDays: 10, availableDays: 10, rate: 1 });
    expect(history.months[3].rate).toBeNull();
    expect(history.properties[0].average).toBe(1);
  });
});
