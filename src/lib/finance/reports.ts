/**
 * P&L + Cash-flow report computation — pure, unit-testable
 *
 * All functions are pure (no DB access). The caller fetches the raw rows
 * via RLS-scoped queries and passes them in. This allows unit testing
 * without a database.
 */

export interface IncomeRow {
  amount: number;
  paid_at: string; // ISO date string
  property_id?: string | null;
}

export interface ExpenseRow {
  amount: number;
  incurred_on: string; // ISO date
  property_id?: string | null;
}

export interface MonthlyPnL {
  month: string; // 'YYYY-MM'
  income: number;
  expenses: number;
  net: number;
}

export interface PropertyPnL {
  property_id: string | null;
  income: number;
  expenses: number;
  net: number;
}

export interface PnLReport {
  byMonth: MonthlyPnL[];
  byProperty: PropertyPnL[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

export interface CashFlowEntry {
  date: string; // 'YYYY-MM-DD'
  type: 'income' | 'expense';
  amount: number;
  label: string;
  property_id: string | null;
}

/** Extract YYYY-MM from an ISO date string */
function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Compute a P&L report from income rows (approved payments) and expense rows.
 * All rows are assumed to be already org-scoped by the caller.
 *
 * @param incomeRows  Approved payment rows (amount, paid_at)
 * @param expenseRows Expense rows (amount, incurred_on)
 */
export function computePnL(
  incomeRows: IncomeRow[],
  expenseRows: ExpenseRow[]
): PnLReport {
  const byMonthMap = new Map<string, { income: number; expenses: number }>();
  const byPropertyMap = new Map<string | null, { income: number; expenses: number }>();

  // Accumulate income
  for (const row of incomeRows) {
    const month = toMonth(row.paid_at);
    const propKey = row.property_id ?? null;

    const m = byMonthMap.get(month) ?? { income: 0, expenses: 0 };
    m.income += row.amount;
    byMonthMap.set(month, m);

    const p = byPropertyMap.get(propKey) ?? { income: 0, expenses: 0 };
    p.income += row.amount;
    byPropertyMap.set(propKey, p);
  }

  // Accumulate expenses
  for (const row of expenseRows) {
    const month = toMonth(row.incurred_on);
    const propKey = row.property_id ?? null;

    const m = byMonthMap.get(month) ?? { income: 0, expenses: 0 };
    m.expenses += row.amount;
    byMonthMap.set(month, m);

    const p = byPropertyMap.get(propKey) ?? { income: 0, expenses: 0 };
    p.expenses += row.amount;
    byPropertyMap.set(propKey, p);
  }

  // Build sorted arrays
  const byMonth: MonthlyPnL[] = Array.from(byMonthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { income, expenses }]) => ({
      month,
      income: round2(income),
      expenses: round2(expenses),
      net: round2(income - expenses),
    }));

  const byProperty: PropertyPnL[] = Array.from(byPropertyMap.entries()).map(
    ([property_id, { income, expenses }]) => ({
      property_id,
      income: round2(income),
      expenses: round2(expenses),
      net: round2(income - expenses),
    })
  );

  const totalIncome = round2(incomeRows.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = round2(expenseRows.reduce((s, r) => s + r.amount, 0));

  return {
    byMonth,
    byProperty,
    totalIncome,
    totalExpenses,
    netIncome: round2(totalIncome - totalExpenses),
  };
}

/**
 * Build a chronological cash-flow timeline from income + expense rows.
 */
export function buildCashFlow(
  incomeRows: IncomeRow[],
  expenseRows: ExpenseRow[]
): CashFlowEntry[] {
  const entries: CashFlowEntry[] = [
    ...incomeRows.map((r) => ({
      date: r.paid_at.slice(0, 10),
      type: 'income' as const,
      amount: r.amount,
      label: 'Payment received',
      property_id: r.property_id ?? null,
    })),
    ...expenseRows.map((r) => ({
      date: r.incurred_on,
      type: 'expense' as const,
      amount: r.amount,
      label: 'Expense',
      property_id: r.property_id ?? null,
    })),
  ];

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// AC24 — computePnLByMonth: 12-month trend grouped by calendar month
// ---------------------------------------------------------------------------

export interface MonthlyTrend {
  /** 'YYYY-MM' */
  month: string;
  grossIncome: number;
  totalExpenses: number;
  trueNetProfit: number;
}

/**
 * computePnLByMonth
 *
 * Groups income and expense rows into monthly buckets for the trailing
 * `months` calendar months (default 12).  Months with no data are included
 * as zeros so the chart always renders exactly `months` bars.
 *
 * Returns an array sorted ascending by month (oldest first).
 *
 * Pure function — no DB access.
 *
 * @param incomeRows   Approved payment rows (already org-scoped by caller)
 * @param expenseRows  Expense rows (already org-scoped by caller)
 * @param months       Number of trailing months to include (default 12)
 */
export function computePnLByMonth(
  incomeRows: IncomeRow[],
  expenseRows: ExpenseRow[],
  months = 12
): MonthlyTrend[] {
  // Build the list of YYYY-MM strings for the trailing N months
  const buckets: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }

  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  for (const bucket of buckets) {
    incomeMap.set(bucket, 0);
    expenseMap.set(bucket, 0);
  }

  for (const row of incomeRows) {
    const m = toMonth(row.paid_at);
    if (incomeMap.has(m)) {
      incomeMap.set(m, (incomeMap.get(m) ?? 0) + row.amount);
    }
  }

  for (const row of expenseRows) {
    const m = toMonth(row.incurred_on);
    if (expenseMap.has(m)) {
      expenseMap.set(m, (expenseMap.get(m) ?? 0) + row.amount);
    }
  }

  return buckets.map((month) => {
    const grossIncome = round2(incomeMap.get(month) ?? 0);
    const totalExpenses = round2(expenseMap.get(month) ?? 0);
    return {
      month,
      grossIncome,
      totalExpenses,
      trueNetProfit: round2(grossIncome - totalExpenses),
    };
  });
}

// ---------------------------------------------------------------------------
// AC23 — computeRoomProfitability: paginated, allowlist-sorted room table
// ---------------------------------------------------------------------------

/**
 * Allowed sort columns for room profitability (prevents SQL injection via
 * string concat — the caller validates the sort param against this enum).
 */
export const ROOM_SORT_COLUMNS = [
  'net_profit',
  'revenue',
  'expenses',
  'occupancy',
] as const;

export type RoomSortColumn = (typeof ROOM_SORT_COLUMNS)[number];

export interface RoomPaymentRow {
  unit_id: string;
  amount: number;
}

export interface RoomExpenseRow {
  unit_id: string | null;
  amount: number;
}

export interface UnitRow {
  id: string;
  label: string;
  property_name?: string | null;
}

export interface RoomProfitabilityRow {
  unit_id: string;
  label: string;
  property_name: string | null;
  revenue: number;
  expenses: number;
  net_profit: number;
  /** Ratio 0–1: 1 = has active contract, 0 = vacant. Placeholder until contract data is joined. */
  occupancy: number;
}

/**
 * computeRoomProfitability
 *
 * Aggregates per-unit revenue (from approved payments via contracts) and
 * expenses, returns a sorted, paginated list.
 *
 * Security: sort column is validated against ROOM_SORT_COLUMNS allowlist —
 * never concatenated raw into a SQL string.
 *
 * Pure function — accepts pre-fetched rows from the caller.
 *
 * @param units         All unit rows for the org
 * @param payments      Payment rows with resolved unit_id
 * @param expenses      Expense rows with unit_id (null if org-level)
 * @param occupiedIds   Set of unit IDs with an active contract (for occupancy flag)
 * @param sort          Validated sort column (must be in ROOM_SORT_COLUMNS)
 * @param page          0-indexed page number
 * @param pageSize      Rows per page (capped server-side at 100)
 */
export function computeRoomProfitability(
  units: UnitRow[],
  payments: RoomPaymentRow[],
  expenses: RoomExpenseRow[],
  occupiedIds: Set<string>,
  sort: RoomSortColumn = 'net_profit',
  page = 0,
  pageSize = 50
): RoomProfitabilityRow[] {
  const SAFE_PAGE_SIZE = Math.min(pageSize, 100); // AC23: max 100 rows

  // Aggregate revenue per unit
  const revenueMap = new Map<string, number>();
  for (const p of payments) {
    revenueMap.set(p.unit_id, (revenueMap.get(p.unit_id) ?? 0) + p.amount);
  }

  // Aggregate expenses per unit (org-level expenses with null unit_id are excluded)
  const expenseMap = new Map<string, number>();
  for (const e of expenses) {
    if (e.unit_id) {
      expenseMap.set(e.unit_id, (expenseMap.get(e.unit_id) ?? 0) + e.amount);
    }
  }

  // Build rows
  const rows: RoomProfitabilityRow[] = units.map((unit) => {
    const revenue = round2(revenueMap.get(unit.id) ?? 0);
    const expenses_total = round2(expenseMap.get(unit.id) ?? 0);
    return {
      unit_id: unit.id,
      label: unit.label,
      property_name: unit.property_name ?? null,
      revenue,
      expenses: expenses_total,
      net_profit: round2(revenue - expenses_total),
      occupancy: occupiedIds.has(unit.id) ? 1 : 0,
    };
  });

  // Sort by validated column (descending by default for profitability metrics)
  rows.sort((a, b) => b[sort] - a[sort]);

  // Paginate
  const start = page * SAFE_PAGE_SIZE;
  return rows.slice(start, start + SAFE_PAGE_SIZE);
}
