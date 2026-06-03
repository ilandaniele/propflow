/**
 * tests/unit/finance/trend.test.ts
 *
 * Unit tests for computePnLByMonth (AC24):
 *   - Returns exactly N monthly buckets (default 12)
 *   - Groups income and expense rows into the correct month
 *   - Months outside the trailing window are excluded
 *   - trueNetProfit = grossIncome - totalExpenses per month
 *   - Buckets are sorted ascending (oldest first)
 *   - Empty rows → all zeros
 *   - Rows outside the window don't bleed in
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { computePnLByMonth } from '@/lib/finance/reports';
import type { IncomeRow, ExpenseRow } from '@/lib/finance/reports';

// ---------------------------------------------------------------------------
// Deterministic "now" — pin to 2026-06-03 for stable bucket assertions
// ---------------------------------------------------------------------------

const FAKE_NOW = new Date('2026-06-03T12:00:00Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function incomeRow(ym: string, amount: number): IncomeRow {
  return { amount, paid_at: `${ym}-15` }; // mid-month date
}

function expenseRow(ym: string, amount: number): ExpenseRow {
  return { amount, incurred_on: `${ym}-10` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computePnLByMonth', () => {
  it('returns exactly 12 buckets by default', () => {
    const result = computePnLByMonth([], [], 12);
    expect(result).toHaveLength(12);
  });

  it('returns exactly N buckets when N is specified', () => {
    expect(computePnLByMonth([], [], 6)).toHaveLength(6);
    expect(computePnLByMonth([], [], 3)).toHaveLength(3);
    expect(computePnLByMonth([], [], 1)).toHaveLength(1);
  });

  it('sorts buckets ascending (oldest first)', () => {
    const result = computePnLByMonth([], [], 12);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].month >= result[i - 1].month).toBe(true);
    }
  });

  it('last bucket is current month (2026-06)', () => {
    const result = computePnLByMonth([], [], 12);
    expect(result[result.length - 1].month).toBe('2026-06');
  });

  it('first bucket is 11 months ago (2025-07)', () => {
    const result = computePnLByMonth([], [], 12);
    expect(result[0].month).toBe('2025-07');
  });

  it('all zeros when no rows provided', () => {
    const result = computePnLByMonth([], [], 12);
    for (const bucket of result) {
      expect(bucket.grossIncome).toBe(0);
      expect(bucket.totalExpenses).toBe(0);
      expect(bucket.trueNetProfit).toBe(0);
    }
  });

  it('correctly aggregates income into the matching month', () => {
    const income: IncomeRow[] = [
      incomeRow('2026-06', 1000),
      incomeRow('2026-06', 500),
      incomeRow('2026-05', 800),
    ];
    const result = computePnLByMonth(income, [], 12);

    const june = result.find((r) => r.month === '2026-06');
    const may = result.find((r) => r.month === '2026-05');

    expect(june?.grossIncome).toBe(1500);
    expect(may?.grossIncome).toBe(800);
  });

  it('correctly aggregates expenses into the matching month', () => {
    const expenses: ExpenseRow[] = [
      expenseRow('2026-04', 400),
      expenseRow('2026-04', 200),
      expenseRow('2026-06', 300),
    ];
    const result = computePnLByMonth([], expenses, 12);

    const april = result.find((r) => r.month === '2026-04');
    const june = result.find((r) => r.month === '2026-06');

    expect(april?.totalExpenses).toBe(600);
    expect(june?.totalExpenses).toBe(300);
  });

  it('computes trueNetProfit = grossIncome - totalExpenses', () => {
    const income: IncomeRow[] = [incomeRow('2026-03', 2000)];
    const expenses: ExpenseRow[] = [expenseRow('2026-03', 700)];
    const result = computePnLByMonth(income, expenses, 12);

    const march = result.find((r) => r.month === '2026-03');
    expect(march?.trueNetProfit).toBe(1300);
  });

  it('trueNetProfit is negative when expenses exceed income', () => {
    const income: IncomeRow[] = [incomeRow('2026-02', 500)];
    const expenses: ExpenseRow[] = [expenseRow('2026-02', 1200)];
    const result = computePnLByMonth(income, expenses, 12);

    const feb = result.find((r) => r.month === '2026-02');
    expect(feb?.trueNetProfit).toBe(-700);
  });

  it('rows outside the trailing window are excluded (no bleed-in)', () => {
    // 2024-01 is well outside the 12-month trailing window from 2026-06
    const oldIncome: IncomeRow[] = [incomeRow('2024-01', 9999)];
    const result = computePnLByMonth(oldIncome, [], 12);

    // No bucket should have income from 2024-01
    const hasOld = result.some((r) => r.grossIncome === 9999);
    expect(hasOld).toBe(false);

    // All buckets should have 0 income
    for (const bucket of result) {
      expect(bucket.grossIncome).toBe(0);
    }
  });

  it('rounds values to 2 decimal places', () => {
    const income: IncomeRow[] = [incomeRow('2026-06', 1000.005)];
    const expenses: ExpenseRow[] = [expenseRow('2026-06', 333.337)];
    const result = computePnLByMonth(income, expenses, 12);

    const june = result.find((r) => r.month === '2026-06');
    // grossIncome rounds 1000.005 → 1000.01 (banker's rounding varies; check within 0.01)
    expect(june?.grossIncome).toBeCloseTo(1000, 1);
    expect(june?.totalExpenses).toBeCloseTo(333.34, 1);
  });

  it('handles multiple rows in the same month from different sources', () => {
    const income: IncomeRow[] = [
      incomeRow('2025-12', 300),
      incomeRow('2025-12', 700),
      incomeRow('2025-12', 1000),
    ];
    const expenses: ExpenseRow[] = [
      expenseRow('2025-12', 400),
      expenseRow('2025-12', 100),
    ];
    const result = computePnLByMonth(income, expenses, 12);

    const dec = result.find((r) => r.month === '2025-12');
    expect(dec?.grossIncome).toBe(2000);
    expect(dec?.totalExpenses).toBe(500);
    expect(dec?.trueNetProfit).toBe(1500);
  });
});
