/**
 * Pure payment-KPI aggregation for the admin Payments dashboard.
 *
 * Extracted from the page so the money math is unit-tested and can't silently
 * regress. IMPORTANT: callers must pass EVERY payment row for the org — never a
 * `.limit()`-capped set — or the totals understate (see PR #50). This function
 * deliberately has no notion of a cap.
 */

export interface PaymentKpiRow {
  amount: string | number;
  status: string;
  method?: string | null;
  paidAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface PaymentKpis {
  totalCount: number;
  approvedCount: number;
  pendingCount: number;
  /** Sum of approved amounts. */
  collectedTotal: number;
  /** Sum of pending amounts. */
  pendingTotal: number;
  /** approved / total, as an integer percentage 0–100. */
  collectionRate: number;
  /** approved payment COUNT per method. */
  byMethod: Record<string, number>;
  /** approved AMOUNT per YYYY-MM bucket (paid_at, falling back to created_at). */
  byMonth: Record<string, number>;
}

export function computePaymentKpis(rows: PaymentKpiRow[]): PaymentKpis {
  const approved = rows.filter((p) => p.status === 'approved');
  const pending = rows.filter((p) => p.status === 'pending');

  const collectedTotal = approved.reduce((s, p) => s + Number(p.amount), 0);
  const pendingTotal = pending.reduce((s, p) => s + Number(p.amount), 0);
  const collectionRate = rows.length > 0 ? Math.round((approved.length / rows.length) * 100) : 0;

  const byMethod: Record<string, number> = {};
  for (const p of approved) {
    const m = p.method ?? 'other';
    byMethod[m] = (byMethod[m] ?? 0) + 1;
  }

  const byMonth: Record<string, number> = {};
  for (const p of approved) {
    const dateStr = p.paidAt ?? p.createdAt;
    if (!dateStr) continue;
    const key = String(dateStr).slice(0, 7); // YYYY-MM
    byMonth[key] = (byMonth[key] ?? 0) + Number(p.amount);
  }

  return {
    totalCount: rows.length,
    approvedCount: approved.length,
    pendingCount: pending.length,
    collectedTotal,
    pendingTotal,
    collectionRate,
    byMethod,
    byMonth,
  };
}
