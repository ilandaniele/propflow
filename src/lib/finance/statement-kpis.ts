/**
 * Pure account-statement KPI aggregation for the dashboard.
 *
 * Extracted so the money math is unit-tested. Callers must pass EVERY statement
 * row for the org — never a `.limit()`-capped set — or the totals understate
 * (see PR #50/#53). `today` (YYYY-MM-DD) is injected to keep the fn deterministic.
 */

export interface StatementKpiRow {
  totalDue?: string | number | null;
  rentAmount?: string | number | null;
  additionalSubtotal?: string | number | null;
  sendStatus?: string | null;
  dueDate?: string | null;
  whatsappMessageId?: string | null;
  sendError?: string | null;
}

export interface StatementKpis<T> {
  sentCount: number;
  errorCount: number;
  totalDue: number;
  totalRent: number;
  totalAddl: number;
  /** additional charges as a % of total due (integer 0–100). */
  additionalsPct: number;
  withWhatsapp: number;
  withError: number;
  /** past-due statements not yet sent. */
  overdue: T[];
  /** statements due exactly today. */
  dueToday: T[];
}

export function computeStatementKpis<T extends StatementKpiRow>(
  rows: T[],
  today: string,
): StatementKpis<T> {
  const totalDue  = rows.reduce((s, r) => s + Number(r.totalDue ?? 0), 0);
  const totalAddl = rows.reduce((s, r) => s + Number(r.additionalSubtotal ?? 0), 0);

  return {
    sentCount: rows.filter((r) => r.sendStatus === 'sent').length,
    errorCount: rows.filter((r) => r.sendStatus === 'error').length,
    totalDue,
    totalRent: rows.reduce((s, r) => s + Number(r.rentAmount ?? 0), 0),
    totalAddl,
    additionalsPct: totalDue > 0 ? Math.round((totalAddl / totalDue) * 100) : 0,
    withWhatsapp: rows.filter((r) => r.whatsappMessageId).length,
    withError: rows.filter((r) => r.sendError).length,
    overdue: rows.filter((r) => r.dueDate && r.dueDate < today && r.sendStatus !== 'sent'),
    dueToday: rows.filter((r) => r.dueDate === today),
  };
}
