import { describe, it, expect } from 'vitest';
import { computeReliabilityScores, scoreLabel } from '@/lib/tenants/reliability';

describe('computeReliabilityScores', () => {
  it('returns 100 for all scores when no data', () => {
    const scores = computeReliabilityScores({
      chargesCount: 0,
      onTimePaymentsCount: 0,
      sanctionsCount: 0,
      disputedCount: 0,
    });
    expect(scores.on_time).toBe(100);
    expect(scores.dispute).toBe(100);
    expect(scores.response).toBe(100);
    expect(typeof scores.computed_at).toBe('string');
  });

  it('computes on_time percentage correctly', () => {
    const scores = computeReliabilityScores({
      chargesCount: 10,
      onTimePaymentsCount: 8,
      sanctionsCount: 0,
      disputedCount: 0,
    });
    expect(scores.on_time).toBe(80);
  });

  it('computes dispute score correctly', () => {
    const scores = computeReliabilityScores({
      chargesCount: 10,
      onTimePaymentsCount: 10,
      sanctionsCount: 4,
      disputedCount: 1,
    });
    expect(scores.dispute).toBe(75); // 1 - (1/4) = 75%
  });

  it('clamps scores to 0-100', () => {
    const scores = computeReliabilityScores({
      chargesCount: 1,
      onTimePaymentsCount: 0,
      sanctionsCount: 5,
      disputedCount: 5,
    });
    expect(scores.on_time).toBe(0);
    expect(scores.dispute).toBe(0);
  });
});

describe('scoreLabel', () => {
  it('returns correct labels for score ranges', () => {
    expect(scoreLabel(95)).toBe('excellent');
    expect(scoreLabel(75)).toBe('good');
    expect(scoreLabel(55)).toBe('fair');
    expect(scoreLabel(30)).toBe('poor');
  });
});
