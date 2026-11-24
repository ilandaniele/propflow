import { describe, it, expect } from 'vitest';
import { splitUtility, occupiedDays, chargeableAmount, type SplitOccupant } from '@/lib/finance/utility-split';

const occupant = (id: string, overrides: Partial<SplitOccupant> = {}): SplitOccupant => ({
  contractId: `c-${id}`, tenantId: `t-${id}`, areaM2: 10, startDate: '2026-01-01', endDate: null, ...overrides,
});

const total = (shares: { amount: number }[]) => Math.round(shares.reduce((s, x) => s + x.amount, 0) * 100) / 100;

describe('chargeableAmount', () => {
  it('charges only the excess over the tope', () => {
    expect(chargeableAmount(150, 100)).toBe(50);
    expect(chargeableAmount(80, 100)).toBe(0);
    expect(chargeableAmount(80, null)).toBe(80);
  });
});

describe('occupiedDays', () => {
  it('counts the days of the month the contract covers', () => {
    expect(occupiedDays(occupant('a'), '2026-02')).toBe(28);
    expect(occupiedDays(occupant('a', { startDate: '2026-03-16' }), '2026-03')).toBe(16);
    expect(occupiedDays(occupant('a', { endDate: '2026-03-10' }), '2026-03')).toBe(10);
    expect(occupiedDays(occupant('a', { startDate: '2026-04-01' }), '2026-03')).toBe(0);
  });
});

describe('splitUtility', () => {
  it('splits equally and keeps the total exact to the cent', () => {
    const shares = splitUtility({ amount: 100, tope: null, month: '2026-03', method: 'equal', occupants: [occupant('a'), occupant('b'), occupant('c')] });
    expect(shares.map((s) => s.amount).sort()).toEqual([33.33, 33.33, 33.34]);
    expect(total(shares)).toBe(100);
  });

  it('splits by area', () => {
    const shares = splitUtility({ amount: 90, tope: null, month: '2026-03', method: 'area', occupants: [occupant('a', { areaM2: 10 }), occupant('b', { areaM2: 20 })] });
    expect(shares).toEqual([
      { contractId: 'c-a', tenantId: 't-a', amount: 30 },
      { contractId: 'c-b', tenantId: 't-b', amount: 60 },
    ]);
  });

  it('splits by occupied days', () => {
    const shares = splitUtility({ amount: 92, tope: null, month: '2026-03', method: 'days', occupants: [occupant('a'), occupant('b', { startDate: '2026-03-17' })] });
    expect(shares.map((s) => s.amount)).toEqual([62, 30]);
  });

  it('splits only the excess over the tope', () => {
    const shares = splitUtility({ amount: 160, tope: 100, month: '2026-03', method: 'equal', occupants: [occupant('a'), occupant('b')] });
    expect(shares.map((s) => s.amount)).toEqual([30, 30]);
  });

  it('returns nothing under the tope, without occupants, or without areas', () => {
    expect(splitUtility({ amount: 90, tope: 100, month: '2026-03', method: 'equal', occupants: [occupant('a')] })).toEqual([]);
    expect(splitUtility({ amount: 90, tope: null, month: '2026-03', method: 'equal', occupants: [] })).toEqual([]);
    expect(splitUtility({ amount: 90, tope: null, month: '2026-03', method: 'area', occupants: [occupant('a', { areaM2: null })] })).toEqual([]);
  });

  it('skips contracts outside the month', () => {
    const shares = splitUtility({ amount: 50, tope: null, month: '2026-03', method: 'equal', occupants: [occupant('a'), occupant('b', { endDate: '2026-02-20' })] });
    expect(shares).toEqual([{ contractId: 'c-a', tenantId: 't-a', amount: 50 }]);
  });
});
