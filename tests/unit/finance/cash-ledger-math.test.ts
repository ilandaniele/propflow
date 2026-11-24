import { describe, it, expect } from 'vitest';
import { currentBalance, liquidate, monthParam, shiftMonth, withRunningBalance, yearMonths } from '@/lib/finance/cash-ledger-math';

const totals = [
  { month: '2026-01', income: 1000, outflow: 200 },
  { month: '2026-03', income: 500.1, outflow: 0.2 },
];

describe('liquidate', () => {
  it('carries balances across months, including empty ones', () => {
    const [jan, feb, mar] = liquidate(100, totals, ['2026-01', '2026-02', '2026-03']);
    expect(jan).toEqual({ month: '2026-01', opening: 100, income: 1000, outflow: 200, closing: 900 });
    expect(feb).toEqual({ month: '2026-02', opening: 900, income: 0, outflow: 0, closing: 900 });
    expect(mar).toEqual({ month: '2026-03', opening: 900, income: 500.1, outflow: 0.2, closing: 1399.9 });
  });

  it('folds months before the window into the opening balance', () => {
    const [mar] = liquidate(100, totals, ['2026-03']);
    expect(mar.opening).toBe(900);
  });

  it('builds a twelve-month annual matrix', () => {
    const year = liquidate(0, totals, yearMonths(2026));
    expect(year).toHaveLength(12);
    expect(year[11]).toMatchObject({ month: '2026-12', closing: 1299.9 });
  });
});

describe('currentBalance', () => {
  it('sums every month onto the opening balance', () => {
    expect(currentBalance(100, totals)).toBe(1399.9);
  });
});

describe('shiftMonth and monthParam', () => {
  it('crosses year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('falls back on invalid input', () => {
    expect(monthParam('2026-13', '2026-11')).toBe('2026-11');
    expect(monthParam(undefined, '2026-11')).toBe('2026-11');
    expect(monthParam('2026-05', '2026-11')).toBe('2026-05');
  });
});

describe('withRunningBalance', () => {
  it('adds income and subtracts outflow row by row', () => {
    const rows = withRunningBalance(50, [
      { direction: 'in', amount: '100.00' },
      { direction: 'out', amount: '30.50' },
    ]);
    expect(rows.map((r) => r.balance)).toEqual([150, 119.5]);
  });
});
