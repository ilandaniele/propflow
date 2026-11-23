import { describe, it, expect } from 'vitest';
import { dueDateFor, monthStart, rentChargesFor, type RentContract } from '@/lib/finance/rent-schedule';

const contract = (overrides: Partial<RentContract> = {}): RentContract => ({
  id: 'c1', orgId: 'o1', tenantId: 't1', startDate: '2026-01-15', endDate: null, monthlyRent: '850.00', ...overrides,
});

describe('monthStart', () => {
  it('returns the first day of the month', () => {
    expect(monthStart('2026-11-22')).toBe('2026-11-01');
  });
});

describe('dueDateFor', () => {
  it('keeps the contract start day', () => {
    expect(dueDateFor('2026-01-15', '2026-11-01')).toBe('2026-11-15');
  });

  it('clamps to the last day of shorter months', () => {
    expect(dueDateFor('2026-01-31', '2026-02-01')).toBe('2026-02-28');
    expect(dueDateFor('2026-01-31', '2028-02-01')).toBe('2028-02-29');
  });
});

describe('rentChargesFor', () => {
  it('creates one rent charge for the current month', () => {
    expect(rentChargesFor([contract()], '2026-11-22')).toEqual([{
      orgId: 'o1', contractId: 'c1', tenantId: 't1', period: '2026-11-01', dueDate: '2026-11-15',
      amount: '850.00', description: 'Renta 2026-11', kind: 'rent',
    }]);
  });

  it('includes a contract that starts later in the same month', () => {
    expect(rentChargesFor([contract({ startDate: '2026-11-28' })], '2026-11-02')).toHaveLength(1);
  });

  it('skips contracts that start in a future month', () => {
    expect(rentChargesFor([contract({ startDate: '2026-12-01' })], '2026-11-22')).toEqual([]);
  });

  it('skips contracts that ended before the month', () => {
    expect(rentChargesFor([contract({ endDate: '2026-10-31' })], '2026-11-22')).toEqual([]);
  });

  it('includes contracts ending during the month', () => {
    expect(rentChargesFor([contract({ endDate: '2026-11-10' })], '2026-11-22')).toHaveLength(1);
  });

  it('skips contracts without a positive rent', () => {
    expect(rentChargesFor([contract({ monthlyRent: '0' })], '2026-11-22')).toEqual([]);
  });
});
