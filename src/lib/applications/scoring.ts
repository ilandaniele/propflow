export type EmploymentType = 'employee' | 'self_employed' | 'retired' | 'student' | 'other';
export type ScoreBand = 'high' | 'medium' | 'low';

export interface SolvencyInput {
  monthlyIncome: number;
  monthlyRent: number | null;
  employmentType: EmploymentType;
  employmentMonths: number;
  hasGuarantor: boolean;
  documentCount: number;
}

const UNKNOWN_RENT_POINTS = 25;
const GUARANTOR_POINTS = 15;
const POINTS_PER_DOCUMENT = 5;
const MAX_SCORED_DOCUMENTS = 3;

function incomeToRentPoints(income: number, rent: number | null): number {
  if (!rent || rent <= 0) return UNKNOWN_RENT_POINTS;
  const ratio = income / rent;
  if (ratio >= 3) return 50;
  if (ratio >= 2.5) return 40;
  if (ratio >= 2) return 25;
  if (ratio >= 1.5) return 10;
  return 0;
}

function stabilityPoints(type: EmploymentType, months: number): number {
  if (type === 'employee' || type === 'retired') {
    if (months >= 12) return 20;
    if (months >= 6) return 12;
    return 5;
  }
  if (type === 'self_employed') {
    if (months >= 24) return 18;
    if (months >= 12) return 12;
    return 5;
  }
  return 5;
}

export function solvencyScore(input: SolvencyInput): number {
  const documents = Math.min(input.documentCount, MAX_SCORED_DOCUMENTS) * POINTS_PER_DOCUMENT;
  const total = incomeToRentPoints(input.monthlyIncome, input.monthlyRent)
    + stabilityPoints(input.employmentType, input.employmentMonths)
    + (input.hasGuarantor ? GUARANTOR_POINTS : 0)
    + documents;
  return Math.max(0, Math.min(100, total));
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}
