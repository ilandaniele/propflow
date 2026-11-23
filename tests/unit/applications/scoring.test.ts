import { describe, it, expect } from 'vitest';
import { scoreBand, solvencyScore, type SolvencyInput } from '@/lib/applications/scoring';

const base: SolvencyInput = {
  monthlyIncome: 6000,
  monthlyRent: 2000,
  employmentType: 'employee',
  employmentMonths: 24,
  hasGuarantor: false,
  documentCount: 0,
};

describe('solvencyScore', () => {
  it('rewards income of three times the rent and stable employment', () => {
    expect(solvencyScore(base)).toBe(70);
  });

  it('gives no ratio points when income is below 1.5x rent', () => {
    expect(solvencyScore({ ...base, monthlyIncome: 2500 })).toBe(20);
  });

  it('uses neutral ratio points when the rent is unknown', () => {
    expect(solvencyScore({ ...base, monthlyRent: null })).toBe(45);
  });

  it('caps scored documents at three', () => {
    expect(solvencyScore({ ...base, documentCount: 10 })).toBe(85);
  });

  it('needs more tenure from self-employed applicants', () => {
    expect(solvencyScore({ ...base, employmentType: 'self_employed', employmentMonths: 12 })).toBe(62);
  });

  it('never exceeds 100', () => {
    expect(solvencyScore({ ...base, hasGuarantor: true, documentCount: 3 })).toBe(100);
  });
});

describe('scoreBand', () => {
  it.each([[70, 'high'], [69, 'medium'], [45, 'medium'], [44, 'low']] as const)('%i is %s', (score, band) => {
    expect(scoreBand(score)).toBe(band);
  });
});
