import { toCsvDocument } from '@/lib/csv/write';
import type { OwnerSettlement } from './owner-settlement';

const HEADER = ['owner', 'property', 'currency', 'income', 'expenses', 'commission_pct', 'commission', 'net_to_owner'];
const money = (value: number) => value.toFixed(2);

export function ownerSettlementCsv(settlements: OwnerSettlement[]) {
  const rows: Array<Array<string | number | null>> = [];
  for (const settlement of settlements) {
    for (const line of settlement.lines) {
      rows.push([settlement.ownerName, line.propertyName, line.currency, money(line.income), money(line.expenses), money(line.commissionPct), money(line.commission), money(line.net)]);
    }
    for (const [currency, total] of Object.entries(settlement.totals)) {
      rows.push([settlement.ownerName, 'TOTAL', currency, money(total.income), money(total.expenses), '', money(total.commission), money(total.net)]);
    }
  }
  return toCsvDocument(HEADER, rows);
}
