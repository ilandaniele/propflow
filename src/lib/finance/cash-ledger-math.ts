export interface MonthTotals {
  month: string;
  income: number;
  outflow: number;
}

export interface MonthSummary extends MonthTotals {
  opening: number;
  closing: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function shiftMonth(month: string, delta: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

export function liquidate(openingBalance: number, totals: MonthTotals[], months: string[]): MonthSummary[] {
  const byMonth = new Map(totals.map((t) => [t.month, t]));
  let balance = totals
    .filter((t) => t.month < months[0])
    .reduce((sum, t) => sum + t.income - t.outflow, openingBalance);

  return months.map((month) => {
    const income = round2(byMonth.get(month)?.income ?? 0);
    const outflow = round2(byMonth.get(month)?.outflow ?? 0);
    const opening = round2(balance);
    balance = opening + income - outflow;
    return { month, income, outflow, opening, closing: round2(balance) };
  });
}

export function currentBalance(openingBalance: number, totals: MonthTotals[]): number {
  return round2(totals.reduce((sum, t) => sum + t.income - t.outflow, openingBalance));
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthParam(raw: string | undefined, fallback: string): string {
  return raw && MONTH_RE.test(raw) ? raw : fallback;
}

export function withRunningBalance<T extends { direction: string; amount: string }>(
  opening: number,
  movements: T[],
): Array<T & { balance: number }> {
  let balance = opening;
  return movements.map((movement) => {
    const amount = Number(movement.amount);
    balance = round2(balance + (movement.direction === 'in' ? amount : -amount));
    return { ...movement, balance };
  });
}
