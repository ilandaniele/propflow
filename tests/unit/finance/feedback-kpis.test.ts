import { describe, it, expect } from 'vitest';
import { averageScore, recommendStats } from '@/lib/finance/feedback-kpis';

describe('averageScore', () => {
  it('averages non-null scores to 1 decimal', () => {
    expect(averageScore([5, 4, 3])).toBe('4.0');
    expect(averageScore([5, 4])).toBe('4.5');
  });
  it('ignores null/undefined', () => {
    expect(averageScore([5, null, 4, undefined])).toBe('4.5');
  });
  it('returns null when no scores present', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([null, null])).toBeNull();
  });
});

describe('recommendStats', () => {
  it('counts wouldRecommend===true and computes integer rate', () => {
    const s = recommendStats([
      { wouldRecommend: true }, { wouldRecommend: true }, { wouldRecommend: false }, { wouldRecommend: null },
    ]);
    expect(s.count).toBe(2);
    expect(s.rate).toBe(50); // 2 of 4
  });
  it('rate is 0 for an empty set (no divide-by-zero)', () => {
    expect(recommendStats([])).toEqual({ count: 0, rate: 0 });
  });
});
