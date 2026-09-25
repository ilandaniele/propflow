import { describe, it, expect } from 'vitest';
import { computeLeadScore, intentTagForScore } from '@/lib/agent/scoring';

describe('computeLeadScore', () => {
  it('returns 0 for an empty profile', () => {
    expect(computeLeadScore({})).toBe(0);
  });

  it('is deterministic — same input always yields the same score', () => {
    const input = { operationType: 'rent', zones: ['Miraflores'], budgetMax: 2000 };
    expect(computeLeadScore(input)).toBe(computeLeadScore(input));
  });

  it('caps at 100 even with every field filled', () => {
    const score = computeLeadScore({
      operationType: 'rent',
      zones: ['Miraflores', 'San Isidro'],
      budgetMax: 2000,
      bedroomsMin: 2,
      moveInDate: '2026-01-01',
      timeline: 'immediate',
      pets: false,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(95); // 15+15+15+10+10+5+25
  });

  it('ignores an empty zones array', () => {
    expect(computeLeadScore({ zones: [] })).toBe(0);
  });

  it('a lead with only urgency scores lower than one with zone + budget', () => {
    const urgencyOnly = computeLeadScore({ timeline: 'immediate' });
    const zoneAndBudget = computeLeadScore({ zones: ['X'], budgetMax: 1000 });
    expect(zoneAndBudget).toBeGreaterThan(urgencyOnly);
  });
});

describe('intentTagForScore', () => {
  it('maps score ranges to the right tag', () => {
    expect(intentTagForScore(0)).toBe('cold');
    expect(intentTagForScore(24)).toBe('cold');
    expect(intentTagForScore(25)).toBe('under_analysis');
    expect(intentTagForScore(49)).toBe('under_analysis');
    expect(intentTagForScore(50)).toBe('qualified');
    expect(intentTagForScore(74)).toBe('qualified');
    expect(intentTagForScore(75)).toBe('high_intent');
    expect(intentTagForScore(100)).toBe('high_intent');
  });
});
