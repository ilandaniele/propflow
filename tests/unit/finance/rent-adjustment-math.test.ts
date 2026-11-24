import { describe, it, expect } from 'vitest';
import { adjustedRent, isAdjustmentDue, isoDaysFrom, nextAnniversary } from '@/lib/finance/rent-adjustment-math';

describe('adjustedRent', () => {
  it('applies the percent and rounds to cents', () => {
    expect(adjustedRent(850, 5)).toBe(892.5);
    expect(adjustedRent(1000, 3.333)).toBe(1033.33);
    expect(adjustedRent(1000, -10)).toBe(900);
  });
});

describe('nextAnniversary', () => {
  it('returns this year when the date has not passed', () => {
    expect(nextAnniversary('2024-12-01', '2026-11-22')).toBe('2026-12-01');
  });
  it('returns next year when the date already passed', () => {
    expect(nextAnniversary('2024-03-10', '2026-11-22')).toBe('2027-03-10');
  });
  it('never returns the start date itself', () => {
    expect(nextAnniversary('2026-11-22', '2026-11-22')).toBe('2027-11-22');
  });
  it('maps Feb 29 to Feb 28 in non-leap years', () => {
    expect(nextAnniversary('2024-02-29', '2026-01-10')).toBe('2026-02-28');
    expect(nextAnniversary('2024-02-29', '2027-06-01')).toBe('2028-02-29');
  });
});

describe('isAdjustmentDue', () => {
  it('is false when the anniversary is beyond the horizon', () => {
    expect(isAdjustmentDue('2027-03-10', null, '2026-12-22')).toBe(false);
  });
  it('is true with no adjustment since the previous anniversary', () => {
    expect(isAdjustmentDue('2026-12-01', null, '2026-12-22')).toBe(true);
    expect(isAdjustmentDue('2026-12-01', '2025-12-01', '2026-12-22')).toBe(true);
  });
  it('is false when already adjusted this period', () => {
    expect(isAdjustmentDue('2026-12-01', '2026-11-15', '2026-12-22')).toBe(false);
  });
});

describe('isoDaysFrom', () => {
  it('adds days and returns an ISO date', () => {
    expect(isoDaysFrom(new Date('2026-11-22T12:00:00Z'), 30)).toBe('2026-12-22');
  });
});
