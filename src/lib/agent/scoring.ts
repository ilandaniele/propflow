/**
 * Deterministic lead scoring — the model reports qualification fields via the
 * update_lead_profile tool, but the SCORE and intent tag are always computed
 * here in code, never by the model (LLM08: no LLM-authored numeric verdicts
 * that drive routing/prioritization).
 */

export interface LeadQualificationInput {
  operationType?: string | null;
  zones?: string[] | null;
  budgetMax?: number | null;
  bedroomsMin?: number | null;
  moveInDate?: string | null;
  timeline?: 'immediate' | '1_3_months' | '3_6_months' | 'flexible' | null;
  pets?: boolean | null;
}

export type IntentTag = 'high_intent' | 'qualified' | 'under_analysis' | 'cold';

const TIMELINE_POINTS: Record<string, number> = {
  immediate: 25,
  '1_3_months': 15,
  '3_6_months': 8,
  flexible: 3,
};

/** 0-100. Pure function — same input always yields the same score. */
export function computeLeadScore(input: LeadQualificationInput): number {
  let score = 0;

  if (input.operationType) score += 15;
  if (input.zones && input.zones.length > 0) score += 15;
  if (input.budgetMax != null) score += 15;
  if (input.bedroomsMin != null) score += 10;
  if (input.moveInDate) score += 10;
  if (input.pets !== null && input.pets !== undefined) score += 5;
  if (input.timeline) score += TIMELINE_POINTS[input.timeline] ?? 0;

  return Math.min(100, score);
}

export function intentTagForScore(score: number): IntentTag {
  if (score >= 75) return 'high_intent';
  if (score >= 50) return 'qualified';
  if (score >= 25) return 'under_analysis';
  return 'cold';
}
