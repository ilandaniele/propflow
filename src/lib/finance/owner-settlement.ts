import { buildProfitabilityReport, type ExpenseByProperty, type IncomeByProperty } from './profitability';

type OwnerKeyed = { ownerId: string; ownerName: string | null; commissionPct: string };
export type OwnerIncomeRow = IncomeByProperty & OwnerKeyed;
export type OwnerExpenseRow = ExpenseByProperty & OwnerKeyed;

export type SettlementLine = {
  propertyId: string | null;
  propertyName: string | null;
  currency: string;
  commissionPct: number;
  income: number;
  expenses: number;
  commission: number;
  net: number;
};

export type OwnerSettlement = {
  ownerId: string;
  ownerName: string | null;
  lines: SettlementLine[];
  totals: Record<string, { income: number; expenses: number; commission: number; net: number }>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildOwnerSettlements(income: OwnerIncomeRow[], expenses: OwnerExpenseRow[]): OwnerSettlement[] {
  const owners = new Map<string, { ownerName: string | null; income: OwnerIncomeRow[]; expenses: OwnerExpenseRow[] }>();
  const pctByProperty = new Map<string | null, number>();
  const ownerFor = (row: OwnerKeyed & { propertyId: string | null }) => {
    pctByProperty.set(row.propertyId, Number(row.commissionPct));
    let owner = owners.get(row.ownerId);
    if (!owner) {
      owner = { ownerName: row.ownerName, income: [], expenses: [] };
      owners.set(row.ownerId, owner);
    }
    return owner;
  };
  for (const row of income) ownerFor(row).income.push(row);
  for (const row of expenses) ownerFor(row).expenses.push(row);

  return [...owners.entries()]
    .map(([ownerId, owner]) => {
      const report = buildProfitabilityReport(owner.income, owner.expenses);
      const totals: OwnerSettlement['totals'] = {};
      const lines = report.lines.map((line) => {
        const commissionPct = pctByProperty.get(line.propertyId) ?? 0;
        const commission = round2((line.income * commissionPct) / 100);
        const settled = { ...line, commissionPct, commission, net: round2(line.net - commission) };
        const total = (totals[line.currency] ??= { income: 0, expenses: 0, commission: 0, net: 0 });
        total.income = round2(total.income + settled.income);
        total.expenses = round2(total.expenses + settled.expenses);
        total.commission = round2(total.commission + settled.commission);
        total.net = round2(total.net + settled.net);
        return settled;
      });
      return { ownerId, ownerName: owner.ownerName, lines, totals };
    })
    .sort((a, b) => (a.ownerName ?? '').localeCompare(b.ownerName ?? ''));
}
