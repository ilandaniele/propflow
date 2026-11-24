import { describe, it, expect } from 'vitest';
import { addMonths, annualCost, doneMonths, dueStatus, nextDue, plannedMonths, taskSchedule } from '@/lib/assets/maintenance-math';

describe('maintenance math', () => {
  it('adds months clamping to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('next due starts at plan start, then follows last completion', () => {
    expect(nextDue('2026-03-01', 6, null)).toBe('2026-03-01');
    expect(nextDue('2026-03-01', 6, '2026-04-10')).toBe('2026-10-10');
  });

  it('classifies due status', () => {
    expect(dueStatus('2026-11-01', '2026-11-22')).toBe('overdue');
    expect(dueStatus('2026-12-10', '2026-11-22')).toBe('soon');
    expect(dueStatus('2027-03-01', '2026-11-22')).toBe('ok');
  });

  it('plans months in a year from start and frequency', () => {
    expect(plannedMonths('2026-02-15', 3, 2026)).toEqual([1, 4, 7, 10]);
    expect(plannedMonths('2026-02-15', 3, 2027)).toEqual([1, 4, 7, 10]);
    expect(plannedMonths('2026-11-01', 12, 2026)).toEqual([10]);
    expect(plannedMonths('2027-05-01', 1, 2026)).toEqual([]);
  });

  it('collects done months of one year', () => {
    expect(doneMonths(['2026-01-05', '2026-01-20', '2025-12-01', '2026-07-01'], 2026)).toEqual([0, 6]);
  });

  it('annual cost multiplies estimate by planned count', () => {
    expect(annualCost('150.50', 4)).toBe(602);
    expect(annualCost(null, 4)).toBe(0);
  });

  it('task schedule combines next due and status', () => {
    expect(taskSchedule({ startsOn: '2026-01-01', frequencyMonths: 1, lastDoneOn: '2026-10-01' }, '2026-11-22')).toEqual({ due: '2026-11-01', status: 'overdue' });
  });
});
