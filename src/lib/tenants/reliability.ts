/**
 * Tenant reliability score computation.
 * Scores are 0-100; higher is better.
 * - on_time: percentage of charges paid by due_date
 * - dispute: inverse of dispute rate (100 = no disputes)
 * - response: placeholder (100 until WhatsApp response data is tracked)
 */

export interface ReliabilityScores {
  on_time: number;
  dispute: number;
  response: number;
  computed_at: string;
}

export interface ChargePaymentData {
  chargesCount: number;
  onTimePaymentsCount: number;
}

export interface SanctionData {
  sanctionsCount: number;
  disputedCount: number;
}

/**
 * Compute reliability scores from charge/payment/sanction data.
 * All scores are integers 0-100.
 */
export function computeReliabilityScores(
  data: ChargePaymentData & SanctionData
): ReliabilityScores {
  const { chargesCount, onTimePaymentsCount, sanctionsCount, disputedCount } = data;

  const on_time = chargesCount > 0
    ? Math.round((onTimePaymentsCount / chargesCount) * 100)
    : 100; // No charges = perfect score (new tenant)

  const dispute = sanctionsCount > 0
    ? Math.round((1 - disputedCount / sanctionsCount) * 100)
    : 100;

  return {
    on_time: Math.max(0, Math.min(100, on_time)),
    dispute: Math.max(0, Math.min(100, dispute)),
    response: 100, // placeholder — expand when WhatsApp response tracking is available
    computed_at: new Date().toISOString(),
  };
}

/**
 * Format a score as a colored label for display.
 */
export function scoreLabel(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}
