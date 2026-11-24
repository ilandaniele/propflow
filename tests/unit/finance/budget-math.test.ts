import { describe, it, expect } from 'vitest';
import { budgetRows, monthsElapsed } from '@/lib/finance/budget-math';

describe('monthsElapsed', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  it('counts the full year for past years and none for future ones', () => {
    expect(monthsElapsed(2025, now)).toBe(12);
    expect(monthsElapsed(2027, now)).toBe(0);
  });

  it('counts months up to the current one for this year', () => {
    expect(monthsElapsed(2026, now)).toBe(11);
  });
});

describe('budgetRows', () => {
  const categories = [
    { categoryId: 'repairs', name: 'Repairs', annualBudget: 1200 },
    { categoryId: 'cleaning', name: 'Cleaning', annualBudget: 0 },
  ];

  it('prorates the budget and compares it with spend to date', () => {
    const [repairs] = budgetRows(categories, [
      { categoryId: 'repairs', month: 1, amount: 150 },
      { categoryId: 'repairs', month: 3, amount: 100 },
      { categoryId: 'repairs', month: 6, amount: 400 },
    ], 3);
    expect(repairs).toMatchObject({ budgetToDate: 300, actualToDate: 250, actualYear: 650, variance: 50, executedPct: 54.2 });
  });

  it('flags overspend with a negative variance and no percentage without budget', () => {
    const [, cleaning] = budgetRows(categories, [{ categoryId: 'cleaning', month: 2, amount: 80 }], 12);
    expect(cleaning).toMatchObject({ budgetToDate: 0, actualToDate: 80, variance: -80, executedPct: null });
  });

  it('adds an uncategorized row only when such spend exists', () => {
    expect(budgetRows(categories, [], 12)).toHaveLength(2);
    const rows = budgetRows(categories, [{ categoryId: null, month: 4, amount: 30 }], 12);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ categoryId: null, name: null, actualYear: 30, variance: -30 });
  });
});
