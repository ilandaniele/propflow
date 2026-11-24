export const RENTAL_TAX_RATE = 0.05;

export type RentalIncomeRow = { propertyId: string; propertyName: string; currency: string; month: number; amount: number };

export type RentalTaxLine = {
  propertyId: string;
  propertyName: string;
  currency: string;
  months: number[];
  total: number;
  tax: number;
};

export type RentalTaxTotals = { currency: string; months: number[]; monthTax: number[]; total: number; tax: number };

const round2 = (value: number) => Math.round(value * 100) / 100;
const emptyMonths = () => Array.from({ length: 12 }, () => 0);
export const rentalTax = (amount: number) => round2(amount * RENTAL_TAX_RATE);

export function buildRentalTaxReport(rows: RentalIncomeRow[]): { lines: RentalTaxLine[]; totals: RentalTaxTotals[] } {
  const lines = new Map<string, RentalTaxLine>();
  const totals = new Map<string, RentalTaxTotals>();

  for (const row of rows) {
    const key = `${row.propertyId}|${row.currency}`;
    const line = lines.get(key) ?? { propertyId: row.propertyId, propertyName: row.propertyName, currency: row.currency, months: emptyMonths(), total: 0, tax: 0 };
    line.months[row.month - 1] = round2(line.months[row.month - 1] + row.amount);
    lines.set(key, line);

    const total = totals.get(row.currency) ?? { currency: row.currency, months: emptyMonths(), monthTax: emptyMonths(), total: 0, tax: 0 };
    total.months[row.month - 1] = round2(total.months[row.month - 1] + row.amount);
    totals.set(row.currency, total);
  }

  for (const line of lines.values()) {
    line.total = round2(line.months.reduce((sum, value) => sum + value, 0));
    line.tax = rentalTax(line.total);
  }
  for (const total of totals.values()) {
    total.monthTax = total.months.map(rentalTax);
    total.total = round2(total.months.reduce((sum, value) => sum + value, 0));
    total.tax = round2(total.monthTax.reduce((sum, value) => sum + value, 0));
  }

  return {
    lines: [...lines.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.currency.localeCompare(b.currency)),
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
