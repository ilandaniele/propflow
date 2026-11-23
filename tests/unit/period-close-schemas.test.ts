import { describe, it, expect } from 'vitest';
import { ClosePeriodSchema, periodOf, periodsOf } from '@/lib/period-close/schemas';

describe('period helpers', () => {
  it('maps a date to its month', () => {
    expect(periodOf('2026-03-31')).toBe('2026-03');
  });

  it('dedupes periods and skips empty dates', () => {
    expect(periodsOf(['2026-03-01', '2026-03-15', null, undefined, '', '2026-04-02'])).toEqual(['2026-03', '2026-04']);
  });
});

describe('ClosePeriodSchema', () => {
  it('accepts YYYY-MM and trims an empty note away', () => {
    expect(ClosePeriodSchema.parse({ period: '2026-02', note: '  ' })).toEqual({ period: '2026-02', note: undefined });
  });

  it('rejects bad months', () => {
    for (const period of ['2026-13', '2026-00', '2026-2', '2026-02-01', '']) {
      expect(ClosePeriodSchema.safeParse({ period }).success).toBe(false);
    }
  });
});
