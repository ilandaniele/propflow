import { describe, it, expect } from 'vitest';
import { buildStatement, statementCode } from '@/lib/finance/monthly-statement';

const base = { rentThisMonth: 1000, extrasThisMonth: 50, rentBefore: 0, extrasBefore: 0, paid: 0 };

describe('buildStatement', () => {
  it('bills the month when nothing is owed from before', () => {
    expect(buildStatement(base)).toEqual({ rentAmount: 1000, additionalSubtotal: 50, previousRentBalance: 0, previousAddlBalance: 0, totalDue: 1050 });
  });

  it('carries unpaid balances from earlier months', () => {
    expect(buildStatement({ ...base, rentBefore: 2000, extrasBefore: 30, paid: 1500 })).toMatchObject({ previousRentBalance: 500, previousAddlBalance: 30, totalDue: 1580 });
  });

  it('applies payments to old rent, old extras, then this month', () => {
    expect(buildStatement({ ...base, rentBefore: 1000, extrasBefore: 30, paid: 1530.5 })).toMatchObject({ previousRentBalance: 0, previousAddlBalance: 0, totalDue: 549.5 });
  });

  it('never goes below zero when the tenant paid ahead', () => {
    expect(buildStatement({ ...base, paid: 5000 })).toMatchObject({ rentAmount: 1000, totalDue: 0 });
  });
});

describe('statementCode', () => {
  it('uses the contract code, or the id prefix when there is none', () => {
    expect(statementCode('2026-03', 'C-17', 'abc')).toBe('EECC-202603-C-17');
    expect(statementCode('2026-03', null, '0123456789')).toBe('EECC-202603-01234567');
  });
});
