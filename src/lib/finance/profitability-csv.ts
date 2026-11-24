import { toCsvDocument } from '@/lib/csv/write';
import type { ProfitabilityLine, ProfitabilityTotals } from './profitability';

const HEADER = ['property', 'currency', 'income', 'expenses', 'net'];
const money = (value: number) => value.toFixed(2);

export function profitabilityCsv({ lines, totals }: { lines: ProfitabilityLine[]; totals: ProfitabilityTotals }) {
  const rows = lines.map((line) => [line.propertyName ?? '', line.currency, money(line.income), money(line.expenses), money(line.net)]);
  for (const [currency, total] of Object.entries(totals)) {
    rows.push(['TOTAL', currency, money(total.income), money(total.expenses), money(total.net)]);
  }
  return toCsvDocument(HEADER, rows);
}
