export const BASE_CURRENCY = 'PEN';

export type IncomeByProperty = { propertyId: string | null; propertyName: string | null; currency: string; total: number };
export type ExpenseByProperty = { propertyId: string | null; propertyName: string | null; total: number };

export type ProfitabilityLine = {
  propertyId: string | null;
  propertyName: string | null;
  currency: string;
  income: number;
  expenses: number;
  net: number;
};

export type ProfitabilityTotals = Record<string, { income: number; expenses: number; net: number }>;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildProfitabilityReport(income: IncomeByProperty[], expenses: ExpenseByProperty[]) {
  const lines = new Map<string, ProfitabilityLine>();
  const lineFor = (propertyId: string | null, propertyName: string | null, currency: string) => {
    const key = `${propertyId ?? ''}|${currency}`;
    let line = lines.get(key);
    if (!line) {
      line = { propertyId, propertyName, currency, income: 0, expenses: 0, net: 0 };
      lines.set(key, line);
    }
    return line;
  };

  for (const row of income) lineFor(row.propertyId, row.propertyName, row.currency).income += Number(row.total);
  for (const row of expenses) lineFor(row.propertyId, row.propertyName, BASE_CURRENCY).expenses += Number(row.total);

  const totals: ProfitabilityTotals = {};
  const sorted = [...lines.values()]
    .map((line) => ({ ...line, income: round2(line.income), expenses: round2(line.expenses), net: round2(line.income - line.expenses) }))
    .sort((a, b) => (a.propertyName ?? '￿').localeCompare(b.propertyName ?? '￿') || a.currency.localeCompare(b.currency));

  for (const line of sorted) {
    const total = (totals[line.currency] ??= { income: 0, expenses: 0, net: 0 });
    total.income = round2(total.income + line.income);
    total.expenses = round2(total.expenses + line.expenses);
    total.net = round2(total.net + line.net);
  }

  return { lines: sorted, totals };
}
