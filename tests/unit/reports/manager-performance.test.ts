import { describe, it, expect } from 'vitest';
import { parsePeriodDays, summarizeManagerPerformance, type ManagerPerformanceRow } from '@/lib/reports/manager-performance';

const row = (overrides: Partial<ManagerPerformanceRow>): ManagerPerformanceRow => ({
  profileId: 'p1',
  name: 'Ana',
  assigned: 0,
  resolved: 0,
  timedResolved: 0,
  resolutionDaysSum: 0,
  ...overrides,
});

describe('parsePeriodDays', () => {
  it('accepts the supported periods', () => {
    expect(parsePeriodDays('30')).toBe(30);
    expect(parsePeriodDays('90')).toBe(90);
    expect(parsePeriodDays('365')).toBe(365);
  });

  it('falls back to 30 days for missing or unsupported values', () => {
    expect(parsePeriodDays(undefined)).toBe(30);
    expect(parsePeriodDays('7')).toBe(30);
    expect(parsePeriodDays('abc')).toBe(30);
  });
});

describe('summarizeManagerPerformance', () => {
  it('derives open counts and per-manager averages, sorted by workload', () => {
    const report = summarizeManagerPerformance([
      row({ profileId: 'a', name: 'Bea', assigned: 2, resolved: 1, timedResolved: 1, resolutionDaysSum: 4 }),
      row({ profileId: 'b', name: 'Ana', assigned: 5, resolved: 3, timedResolved: 3, resolutionDaysSum: 3.5 }),
      row({ profileId: 'c', name: 'Carlos' }),
    ]);

    expect(report.managers).toEqual([
      { profileId: 'b', name: 'Ana', assigned: 5, resolved: 3, open: 2, avgResolutionDays: 1.2 },
      { profileId: 'a', name: 'Bea', assigned: 2, resolved: 1, open: 1, avgResolutionDays: 4 },
      { profileId: 'c', name: 'Carlos', assigned: 0, resolved: 0, open: 0, avgResolutionDays: null },
    ]);
  });

  it('weights the overall average by resolved incidents, not by manager', () => {
    const report = summarizeManagerPerformance([
      row({ profileId: 'a', assigned: 3, resolved: 3, timedResolved: 3, resolutionDaysSum: 3 }),
      row({ profileId: 'b', assigned: 1, resolved: 1, timedResolved: 1, resolutionDaysSum: 9 }),
    ]);
    expect(report.totals).toEqual({ assigned: 4, resolved: 4, open: 0, avgResolutionDays: 3 });
  });

  it('returns a null average when nothing resolved has a resolution date', () => {
    const report = summarizeManagerPerformance([row({ assigned: 2, resolved: 1 })]);
    expect(report.totals.avgResolutionDays).toBeNull();
    expect(report.managers[0].avgResolutionDays).toBeNull();
  });
});
