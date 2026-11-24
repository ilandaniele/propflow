import { describe, it, expect } from 'vitest';
import { rentalYield, rentAdjustment, splitExpense } from '@/lib/calculators';

describe('rentalYield', () => {
  it('computes gross and net yield with vacancy and expenses', () => {
    const r = rentalYield({ price: 120000, monthlyRent: 1000, monthlyExpenses: 100, vacancyMonths: 1 });
    expect(r.grossYield).toBe(10);
    expect(r.annualIncome).toBe(11000);
    expect(r.annualNet).toBe(9800);
    expect(r.netYield).toBe(8.17);
    expect(r.paybackYears).toBe(12.24);
  });

  it('returns zero yields and no payback when price is zero or net is negative', () => {
    expect(rentalYield({ price: 0, monthlyRent: 1000, monthlyExpenses: 0, vacancyMonths: 0 }).grossYield).toBe(0);
    expect(rentalYield({ price: 1000, monthlyRent: 10, monthlyExpenses: 50, vacancyMonths: 0 }).paybackYears).toBeNull();
  });

  it('clamps vacancy above 12 months', () => {
    expect(rentalYield({ price: 1000, monthlyRent: 10, monthlyExpenses: 0, vacancyMonths: 20 }).annualIncome).toBe(0);
  });
});

describe('rentAdjustment', () => {
  it('applies the percentage', () => {
    expect(rentAdjustment(1500, 3.5)).toEqual({ newRent: 1552.5, difference: 52.5 });
  });

  it('handles negative adjustments', () => {
    expect(rentAdjustment(1000, -10)).toEqual({ newRent: 900, difference: -100 });
  });
});

describe('splitExpense', () => {
  it('splits equally and keeps the total exact', () => {
    const shares = splitExpense(100, [{ label: 'A', area: 0 }, { label: 'B', area: 0 }, { label: 'C', area: 0 }], false);
    expect(shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('splits by area', () => {
    const shares = splitExpense(300, [{ label: 'A', area: 50 }, { label: 'B', area: 100 }], true);
    expect(shares).toEqual([{ label: 'A', amount: 100 }, { label: 'B', amount: 200 }]);
  });

  it('falls back to equal split when total area is zero', () => {
    expect(splitExpense(10, [{ label: 'A', area: 0 }, { label: 'B', area: 0 }], true).map((s) => s.amount)).toEqual([5, 5]);
  });

  it('returns empty for no units', () => {
    expect(splitExpense(10, [], false)).toEqual([]);
  });
});
