import { describe, it, expect } from 'vitest';
import { renewalTerm } from '@/lib/contracts/renewal';

describe('renewalTerm', () => {
  it('starts the day after the current end and lasts the given months', () => {
    expect(renewalTerm('2026-12-31', 12, '2026-11-22')).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
  });

  it('handles month-end starts', () => {
    expect(renewalTerm('2027-01-30', 1, '2026-11-22')).toEqual({ startDate: '2027-01-31', endDate: '2027-02-27' });
  });

  it('crosses leap years', () => {
    expect(renewalTerm('2028-02-28', 6, '2026-11-22')).toEqual({ startDate: '2028-02-29', endDate: '2028-08-28' });
  });

  it('starts today for an open-ended contract', () => {
    expect(renewalTerm(null, 6, '2026-11-22')).toEqual({ startDate: '2026-11-22', endDate: '2027-05-21' });
  });
});
