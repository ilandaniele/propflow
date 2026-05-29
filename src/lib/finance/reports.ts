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
