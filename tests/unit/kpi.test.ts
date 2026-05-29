import { describe, it, expect } from 'vitest';
import { computeOccupancyRate, isCurrentMonth, computeRentCollectedThisMonth } from '@/lib/kpi';

describe('computeOccupancyRate', () => {
  it('returns 100% when all units occupied', () => {
    expect(computeOccupancyRate(10, 10)).toBe(100);
  });

  it('returns 0% when no units occupied', () => {
    expect(computeOccupancyRate(0, 10)).toBe(0);
  });

  it('returns 0% when there are no units', () => {
    expect(computeOccupancyRate(0, 0)).toBe(0);
  });

  it('rounds to nearest integer', () => {
    expect(computeOccupancyRate(7, 10)).toBe(70);
    expect(computeOccupancyRate(3, 7)).toBe(43); // 3/7 = 42.857 -> 43
  });
});

describe('isCurrentMonth', () => {
  it('returns true for today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(isCurrentMonth(today)).toBe(true);
  });

  it('returns false for a date last month', () => {
    const lastMonth = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const thisMonth = isCurrentMonth(lastMonth);
    // Only false if we actually rolled over into a new month
    const d = new Date(lastMonth);
    const n = new Date();
    const expected = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    expect(thisMonth).toBe(expected);
  });

  it('returns false for a date next month', () => {
    const nextMonth = new Date(Date.now() + 35 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const d = new Date(nextMonth);
    const n = new Date();
    const expected = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    expect(isCurrentMonth(nextMonth)).toBe(expected);
  });
});

describe('computeRentCollectedThisMonth', () => {
  const today = new Date().toISOString().split('T')[0];
  const lastMonth = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString().split('T')[0];

  it('sums only payments from the current month', () => {
    const payments = [
      { amount: 1500, paid_at: today },
      { amount: 500, paid_at: today },
      { amount: 2000, paid_at: lastMonth }, // should be excluded
    ];
    const result = computeRentCollectedThisMonth(payments);
    expect(result).toBe(2000);
  });

  it('returns 0 with no payments', () => {
    expect(computeRentCollectedThisMonth([])).toBe(0);
  });

  it('returns 0 with only last month payments', () => {
    expect(computeRentCollectedThisMonth([{ amount: 1000, paid_at: lastMonth }])).toBe(0);
  });
});
