/**
 * tests/unit/finance/kpis.test.ts
 *
 * Unit tests for KPI pure functions (AC22):
 *   - computeTrueNetProfit
 *   - computeTurnCost
 *   - computeCapEx
 *   - computeDebtService
 *   - computePlatformFees
 *   - computeOccupancy
 *   - computePastDueBalance
 */

import { describe, it, expect } from 'vitest';
import {
  computeTrueNetProfit,
  computeTurnCost,
  computeCapEx,
  computeDebtService,
  computePlatformFees,
  computeOccupancy,
  computePastDueBalance,
} from '@/lib/finance/kpis';
import type { ExpenseWithCategory } from '@/lib/finance/kpis';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const expenses: ExpenseWithCategory[] = [
  { amount: 500, category_name: 'turn_costs' },
  { amount: 300, category_name: 'turn_costs' },
  { amount: 1200, category_name: 'capex' },
  { amount: 800, category_name: 'debt_service' },
  { amount: 150, category_name: 'platform_fees' },
  { amount: 250, category_name: 'platform_fees' },
  { amount: 600, category_name: 'cleaning' },
  { amount: 100, category_name: null },
];

// ---------------------------------------------------------------------------
// computeTrueNetProfit
// ---------------------------------------------------------------------------

describe('computeTrueNetProfit', () => {
  it('returns income - expenses as value', () => {
    const result = computeTrueNetProfit(5000, 2000);
    expect(result.value).toBe(3000);
  });

  it('formats as currency string', () => {
    const result = computeTrueNetProfit(5000, 2000);
    expect(result.formatted).toBe('$3,000.00');
  });

  it('returns negative value when expenses exceed income', () => {
    const result = computeTrueNetProfit(1000, 2500);
    expect(result.value).toBe(-1500);
  });

  it('returns null delta when no prior period data', () => {
    const result = computeTrueNetProfit(5000, 2000);
    expect(result.delta).toBeNull();
  });

  it('computes delta when prior period data provided', () => {
    // Current net: 3000, prior net: 2000 → delta = (3000-2000)/2000 * 100 = 50%
    const result = computeTrueNetProfit(5000, 2000, 4000, 2000);
    expect(result.delta).toBe(50);
  });

  it('returns 0 value and formatted $0.00 when both are 0', () => {
    const result = computeTrueNetProfit(0, 0);
    expect(result.value).toBe(0);
    expect(result.formatted).toBe('$0.00');
  });

  it('rounds to 2 decimal places', () => {
    const result = computeTrueNetProfit(1000.005, 333.337);
    // 1000.005 - 333.337 = 666.668 → rounded to 666.67
    expect(result.value).toBeCloseTo(666.67, 1);
  });
});

// ---------------------------------------------------------------------------
// computeTurnCost
// ---------------------------------------------------------------------------

describe('computeTurnCost', () => {
  it('sums only turn_costs category', () => {
    const result = computeTurnCost(expenses);
    expect(result.value).toBe(800); // 500 + 300
  });

  it('formatted is currency string', () => {
    const result = computeTurnCost(expenses);
    expect(result.formatted).toBe('$800.00');
  });

  it('returns 0 when no turn_costs expenses', () => {
    const noTurnCosts: ExpenseWithCategory[] = [
      { amount: 500, category_name: 'cleaning' },
      { amount: 300, category_name: 'capex' },
    ];
    const result = computeTurnCost(noTurnCosts);
    expect(result.value).toBe(0);
  });

  it('computes delta relative to prior period', () => {
    // current: 800, prior: 400 → delta = +100%
    const result = computeTurnCost(expenses, 400);
    expect(result.delta).toBe(100);
  });

  it('returns null delta when prior is null', () => {
    const result = computeTurnCost(expenses, null);
    expect(result.delta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeCapEx
// ---------------------------------------------------------------------------

describe('computeCapEx', () => {
  it('sums only capex category', () => {
    const result = computeCapEx(expenses);
    expect(result.value).toBe(1200);
  });

  it('returns 0 for empty expenses list', () => {
    const result = computeCapEx([]);
    expect(result.value).toBe(0);
  });

  it('ignores expenses with null category', () => {
    const mixed: ExpenseWithCategory[] = [
      { amount: 999, category_name: null },
      { amount: 500, category_name: 'capex' },
    ];
    const result = computeCapEx(mixed);
    expect(result.value).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// computeDebtService
// ---------------------------------------------------------------------------

describe('computeDebtService', () => {
  it('sums only debt_service category', () => {
    const result = computeDebtService(expenses);
    expect(result.value).toBe(800);
  });

  it('delta is negative when current < prior', () => {
    // current: 800, prior: 1000 → delta = (800-1000)/1000 * 100 = -20%
    const result = computeDebtService(expenses, 1000);
    expect(result.delta).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
// computePlatformFees
// ---------------------------------------------------------------------------

describe('computePlatformFees', () => {
  it('sums only platform_fees category', () => {
    const result = computePlatformFees(expenses);
    expect(result.value).toBe(400); // 150 + 250
  });

  it('returns $400.00 formatted', () => {
    const result = computePlatformFees(expenses);
    expect(result.formatted).toBe('$400.00');
  });
});

// ---------------------------------------------------------------------------
// computeOccupancy
// ---------------------------------------------------------------------------

describe('computeOccupancy', () => {
  it('computes ratio correctly', () => {
    const result = computeOccupancy(8, 10);
    expect(result.value).toBe(0.8);
  });

  it('formats as percentage string', () => {
    const result = computeOccupancy(8, 10);
    expect(result.formatted).toBe('80.0%');
  });

  it('returns 0 when totalUnits is 0', () => {
    const result = computeOccupancy(0, 0);
    expect(result.value).toBe(0);
    expect(result.formatted).toBe('0.0%');
  });

  it('returns 100% when all units occupied', () => {
    const result = computeOccupancy(5, 5);
    expect(result.value).toBe(1);
    expect(result.formatted).toBe('100.0%');
  });

  it('computes delta in percentage points', () => {
    // Current: 8/10 = 0.80, prior: 6/10 = 0.60 → delta = (0.80-0.60)*100 = 20pp
    const result = computeOccupancy(8, 10, 6, 10);
    expect(result.delta).toBe(20);
  });

  it('returns null delta when prior total is 0', () => {
    const result = computeOccupancy(8, 10, 0, 0);
    expect(result.delta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computePastDueBalance
// ---------------------------------------------------------------------------

describe('computePastDueBalance', () => {
  it('sums all overdue amounts', () => {
    const result = computePastDueBalance([200, 350, 50]);
    expect(result.value).toBe(600);
  });

  it('returns 0 for empty array', () => {
    const result = computePastDueBalance([]);
    expect(result.value).toBe(0);
    expect(result.formatted).toBe('$0.00');
  });

  it('formats correctly', () => {
    const result = computePastDueBalance([1500, 250.5]);
    expect(result.formatted).toBe('$1,750.50');
  });

  it('positive delta means past-due WORSENED (increased)', () => {
    // Current: 600, prior: 400 → delta = +50%
    const result = computePastDueBalance([200, 350, 50], 400);
    expect(result.delta).toBe(50);
  });

  it('null delta when prior is null', () => {
    const result = computePastDueBalance([100], null);
    expect(result.delta).toBeNull();
  });
});
