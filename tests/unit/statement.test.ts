import { describe, it, expect } from 'vitest';
import { computeBalance, isOverdue, buildStatement } from '@/lib/finance/statement';

describe('computeBalance', () => {
  it('returns positive balance when payments exceed charges', () => {
    expect(computeBalance(1000, 1500)).toBe(500);
  });

  it('returns negative balance (debt) when charges exceed payments', () => {
    expect(computeBalance(3000, 2000)).toBe(-1000);
  });

  it('returns zero when charges equal payments', () => {
    expect(computeBalance(1500, 1500)).toBe(0);
  });

  it('handles zero values', () => {
    expect(computeBalance(0, 0)).toBe(0);
    expect(computeBalance(1000, 0)).toBe(-1000);
    expect(computeBalance(0, 500)).toBe(500);
  });
});

describe('isOverdue', () => {
  const pastDate = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split('T')[0];
  const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0];

  it('returns false when balance is zero', () => {
    expect(isOverdue(0, [{ due_date: pastDate, amount: 100 }])).toBe(false);
  });

  it('returns false when balance is positive', () => {
    expect(isOverdue(500, [{ due_date: pastDate, amount: 100 }])).toBe(false);
  });

  it('returns true when balance is negative AND a past due charge exists', () => {
    expect(isOverdue(-1000, [{ due_date: pastDate, amount: 100 }])).toBe(true);
  });

  it('returns false when balance is negative but no past due charges', () => {
    expect(isOverdue(-500, [{ due_date: futureDate, amount: 100 }])).toBe(false);
  });

  it('returns false when balance is negative but all due_dates are null', () => {
    expect(isOverdue(-500, [{ due_date: null, amount: 100 }])).toBe(false);
  });

  it('returns false with empty charges array', () => {
    expect(isOverdue(-500, [])).toBe(false);
  });
});

describe('buildStatement', () => {
  it('computes statement with debt and overdue flag', () => {
    const pastDate = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const charges = [{ amount: 3000, due_date: pastDate }];
    const payments = [{ amount: 2000 }];

    const stmt = buildStatement('tenant-1', charges, payments);

    expect(stmt.tenant_id).toBe('tenant-1');
    expect(stmt.total_charges).toBe(3000);
    expect(stmt.total_approved_payments).toBe(2000);
    expect(stmt.balance).toBe(-1000);
    expect(stmt.is_overdue).toBe(true);
  });

  it('computes zero balance with matching charges and payments', () => {
    const stmt = buildStatement('t', [{ amount: 1500, due_date: null }], [{ amount: 1500 }]);
    expect(stmt.balance).toBe(0);
    expect(stmt.is_overdue).toBe(false);
  });
});
