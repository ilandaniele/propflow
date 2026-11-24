import { describe, it, expect } from 'vitest';
import { canRecord, heldDeposit } from '@/lib/finance/deposit';

const totals = { collected: 1700, deducted: 250.3, refunded: 400 };

describe('heldDeposit', () => {
  it('subtracts deductions and refunds from collections', () => {
    expect(heldDeposit(totals)).toBe(1049.7);
  });

  it('is zero with no movements', () => {
    expect(heldDeposit({ collected: 0, deducted: 0, refunded: 0 })).toBe(0);
  });
});

describe('canRecord', () => {
  it('always allows a collection', () => {
    expect(canRecord('collected', 99999, { collected: 0, deducted: 0, refunded: 0 })).toBe(true);
  });

  it('allows a deduction or refund up to the held amount', () => {
    expect(canRecord('deduction', 1049.7, totals)).toBe(true);
    expect(canRecord('refund', 1049.7, totals)).toBe(true);
  });

  it('rejects a deduction or refund above the held amount', () => {
    expect(canRecord('deduction', 1049.71, totals)).toBe(false);
    expect(canRecord('refund', 2000, totals)).toBe(false);
  });
});
