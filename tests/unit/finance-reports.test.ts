import { describe, it, expect } from 'vitest';
import { computePnL, buildCashFlow, type IncomeRow, type ExpenseRow } from '@/lib/finance/reports';

describe('computePnL', () => {
  it('returns zero net for empty org', () => {
    const result = computePnL([], []);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.netIncome).toBe(0);
    expect(result.byMonth).toHaveLength(0);
  });

  it('computes net = income - expenses for single month', () => {
    const income: IncomeRow[] = [
      { amount: 1500, paid_at: '2026-05-10' },
      { amount: 3500, paid_at: '2026-05-15' },
    ];
    const expenses: ExpenseRow[] = [
      { amount: 2000, incurred_on: '2026-05-08' },
    ];

    const result = computePnL(income, expenses);
    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(2000);
    expect(result.netIncome).toBe(3000);
    expect(result.byMonth).toHaveLength(1);
    expect(result.byMonth[0].month).toBe('2026-05');
    expect(result.byMonth[0].net).toBe(3000);
  });

  it('groups by month correctly across 2 months', () => {
    const income: IncomeRow[] = [
      { amount: 1000, paid_at: '2026-04-01' },
      { amount: 2000, paid_at: '2026-05-01' },
    ];
    const expenses: ExpenseRow[] = [
      { amount: 500, incurred_on: '2026-04-15' },
    ];

    const result = computePnL(income, expenses);
    expect(result.byMonth).toHaveLength(2);
    const april = result.byMonth.find(m => m.month === '2026-04');
    const may = result.byMonth.find(m => m.month === '2026-05');
    expect(april?.net).toBe(500);
    expect(may?.net).toBe(2000);
  });

  it('org-scoped: does not mix data across calls', () => {
    // Simulates that Org A data and Org B data are never mixed
    const orgAIncome: IncomeRow[] = [{ amount: 5000, paid_at: '2026-05-01' }];
    const orgBIncome: IncomeRow[] = [{ amount: 9999, paid_at: '2026-05-01' }];

    const resultA = computePnL(orgAIncome, []);
    const resultB = computePnL(orgBIncome, []);

    expect(resultA.totalIncome).toBe(5000);
    expect(resultB.totalIncome).toBe(9999);
    // Org A result never includes Org B data
    expect(resultA.totalIncome).not.toBe(resultB.totalIncome);
  });

  it('rounds amounts to 2 decimal places', () => {
    const income: IncomeRow[] = [{ amount: 1000.001, paid_at: '2026-05-01' }];
    const expenses: ExpenseRow[] = [{ amount: 333.333, incurred_on: '2026-05-01' }];
    const result = computePnL(income, expenses);
    expect(result.netIncome).toBe(666.67);
  });

  it('sorts byMonth ascending', () => {
    const income: IncomeRow[] = [
      { amount: 100, paid_at: '2026-06-01' },
      { amount: 100, paid_at: '2026-03-01' },
      { amount: 100, paid_at: '2026-01-01' },
    ];
    const result = computePnL(income, []);
    const months = result.byMonth.map(m => m.month);
    expect(months).toEqual(['2026-01', '2026-03', '2026-06']);
  });
});

describe('buildCashFlow', () => {
  it('returns empty for no data', () => {
    expect(buildCashFlow([], [])).toHaveLength(0);
  });

  it('merges income and expenses sorted by date', () => {
    const income: IncomeRow[] = [{ amount: 1000, paid_at: '2026-05-10' }];
    const expenses: ExpenseRow[] = [{ amount: 200, incurred_on: '2026-05-05' }];

    const flow = buildCashFlow(income, expenses);
    expect(flow).toHaveLength(2);
    expect(flow[0].type).toBe('expense'); // earlier date first
    expect(flow[0].date).toBe('2026-05-05');
    expect(flow[1].type).toBe('income');
    expect(flow[1].date).toBe('2026-05-10');
  });

  it('marks types correctly', () => {
    const income: IncomeRow[] = [{ amount: 500, paid_at: '2026-05-01' }];
    const expenses: ExpenseRow[] = [{ amount: 100, incurred_on: '2026-05-02' }];
    const flow = buildCashFlow(income, expenses);
    expect(flow.find(e => e.type === 'income')?.amount).toBe(500);
    expect(flow.find(e => e.type === 'expense')?.amount).toBe(100);
  });
});
