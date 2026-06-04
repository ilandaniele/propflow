/**
 * src/lib/finance/kpis.ts
 *
 * Pure KPI functions for the Financial Dashboard (AC22).
 *
 * All functions accept raw data rows (fetched by the caller via RLS-scoped
 * Supabase queries) and return a typed KpiResult so they remain
 * unit-testable without a database.
 *
 * Each function:
 *   - Accepts typed row arrays or simple numeric values
 *   - Returns { value: number, formatted: string, delta?: number | null }
 *   - Has no side-effects (pure — no DB access, no fetch)
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface KpiResult {
  /** Raw numeric value */
  value: number;
  /** Human-readable formatted string (e.g. "$1,234.56", "87.3%") */
  formatted: string;
  /**
   * Percentage change vs prior period: positive = improvement, negative = decline.
   * null when no prior-period data available.
   */
  delta: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/**
 * Compute percentage delta between a current and prior value.
 * Returns null if prior is 0 (avoids division by zero).
 */
function computeDelta(current: number, prior: number | null | undefined): number | null {
  if (prior == null || prior === 0) return null;
  return round2(((current - prior) / Math.abs(prior)) * 100);
}

// ---------------------------------------------------------------------------
// Expense rows shape (used by multiple KPIs)
// ---------------------------------------------------------------------------

export interface ExpenseWithCategory {
  amount: number;
  category_name: string | null;
}

// ---------------------------------------------------------------------------
// AC22 KPI #1 — True Net Profit
// ---------------------------------------------------------------------------

/**
 * computeTrueNetProfit
 *
 * True Net Profit = Total approved-payment income − Total expenses for the period.
 *
 * @param totalIncome    Sum of approved payments in the current period
 * @param totalExpenses  Sum of all expenses in the current period
 * @param priorIncome    Sum of approved payments in the prior period (for delta)
 * @param priorExpenses  Sum of all expenses in the prior period (for delta)
 */
export function computeTrueNetProfit(
  totalIncome: number,
  totalExpenses: number,
  priorIncome?: number | null,
  priorExpenses?: number | null
): KpiResult {
  const value = round2(totalIncome - totalExpenses);
  const formatted = formatCurrency(value);

  let delta: number | null = null;
  if (priorIncome != null && priorExpenses != null) {
    const priorNet = round2(priorIncome - priorExpenses);
    delta = computeDelta(value, priorNet);
  }

  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #2 — Turn Cost
// ---------------------------------------------------------------------------

/**
 * computeTurnCost
 *
 * Sum of expenses in the 'turn_costs' category for the period.
 *
 * @param expenses     Expense rows with their category name
 * @param priorAmount  Prior-period turn cost for delta computation
 */
export function computeTurnCost(
  expenses: ExpenseWithCategory[],
  priorAmount?: number | null
): KpiResult {
  const value = round2(
    expenses
      .filter((e) => e.category_name === 'turn_costs')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
  );
  const formatted = formatCurrency(value);
  const delta = computeDelta(value, priorAmount ?? null);
  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #3 — CapEx
// ---------------------------------------------------------------------------

/**
 * computeCapEx
 *
 * Sum of expenses in the 'capex' category for the period.
 */
export function computeCapEx(
  expenses: ExpenseWithCategory[],
  priorAmount?: number | null
): KpiResult {
  const value = round2(
    expenses
      .filter((e) => e.category_name === 'capex')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
  );
  const formatted = formatCurrency(value);
  const delta = computeDelta(value, priorAmount ?? null);
  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #4 — Debt Service
// ---------------------------------------------------------------------------

/**
 * computeDebtService
 *
 * Sum of expenses in the 'debt_service' category for the period.
 */
export function computeDebtService(
  expenses: ExpenseWithCategory[],
  priorAmount?: number | null
): KpiResult {
  const value = round2(
    expenses
      .filter((e) => e.category_name === 'debt_service')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
  );
  const formatted = formatCurrency(value);
  const delta = computeDelta(value, priorAmount ?? null);
  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #5 — Platform Fees
// ---------------------------------------------------------------------------

/**
 * computePlatformFees
 *
 * Sum of expenses in the 'platform_fees' category for the period.
 */
export function computePlatformFees(
  expenses: ExpenseWithCategory[],
  priorAmount?: number | null
): KpiResult {
  const value = round2(
    expenses
      .filter((e) => e.category_name === 'platform_fees')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
  );
  const formatted = formatCurrency(value);
  const delta = computeDelta(value, priorAmount ?? null);
  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #6 — Occupancy
// ---------------------------------------------------------------------------

/**
 * computeOccupancy
 *
 * Occupancy = occupied_units / total_units.
 * Returns a value in [0, 1]; formatted as "X.X%".
 *
 * @param occupiedUnits  Number of units with an active contract
 * @param totalUnits     Total number of units in the org
 * @param priorOccupied  Prior-period occupied count (for delta)
 * @param priorTotal     Prior-period total count (for delta)
 */
export function computeOccupancy(
  occupiedUnits: number,
  totalUnits: number,
  priorOccupied?: number | null,
  priorTotal?: number | null
): KpiResult {
  const value = totalUnits > 0 ? round2(occupiedUnits / totalUnits) : 0;
  const formatted = formatPercent(value);

  let delta: number | null = null;
  if (priorOccupied != null && priorTotal != null && priorTotal > 0) {
    const priorValue = round2(priorOccupied / priorTotal);
    // Delta in percentage points (not percentage of percentage)
    delta = round2((value - priorValue) * 100);
  }

  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// AC22 KPI #7 — Past Due Balance
// ---------------------------------------------------------------------------

/**
 * computePastDueBalance
 *
 * Sum of overdue charges — charges whose due_date is in the past and are
 * not fully collected.
 *
 * @param overdueAmounts  Array of overdue charge amounts (already filtered by date)
 * @param priorAmount     Prior-period past due total for delta
 */
export function computePastDueBalance(
  overdueAmounts: number[],
  priorAmount?: number | null
): KpiResult {
  const value = round2(overdueAmounts.reduce((sum, a) => sum + (a ?? 0), 0));
  const formatted = formatCurrency(value);
  const delta = computeDelta(value, priorAmount ?? null);
  return { value, formatted, delta };
}

// ---------------------------------------------------------------------------
// Legacy helpers — consolidated from src/lib/kpi.ts (AC2)
//
// These three functions were previously in the now-deleted src/lib/kpi.ts.
// Signatures and behaviour are identical to the originals so all call-sites
// continue to work without modification.
// ---------------------------------------------------------------------------

/** @deprecated Use computeOccupancy() for the full KpiResult form. */
export function computeOccupancyRate(occupiedUnits: number, totalUnits: number): number {
  if (totalUnits === 0) return 0;
  return Math.round((occupiedUnits / totalUnits) * 100);
}

export function isCurrentMonth(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function computeRentCollectedThisMonth(
  approvedPayments: Array<{ amount: number; paid_at: string }>
): number {
  return approvedPayments
    .filter((p) => isCurrentMonth(p.paid_at))
    .reduce((sum, p) => sum + p.amount, 0);
}
