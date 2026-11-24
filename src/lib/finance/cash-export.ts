import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cashAccounts } from '@/lib/db/schema';
import { toCsvDocument } from '@/lib/csv/cell';
import { listCashAccounts, listMonthMovements, monthlyTotalsByAccount } from './cash-accounts';
import { liquidate, withRunningBalance, yearMonths } from './cash-ledger-math';

const amount = (value: number) => value.toFixed(2);

export async function buildAnnualLiquidationCsv(orgId: string, year: number): Promise<string> {
  const [accounts, totals] = await Promise.all([listCashAccounts(orgId), monthlyTotalsByAccount(orgId)]);
  const months = yearMonths(year);
  const rows = accounts.flatMap((account) =>
    liquidate(Number(account.openingBalance), totals.get(account.id) ?? [], months).map((m) => [
      account.name, m.month, amount(m.opening), amount(m.income), amount(m.outflow), amount(m.closing),
    ]),
  );
  return toCsvDocument(['cuenta', 'mes', 'saldo_inicial', 'ingresos', 'egresos', 'saldo_final'], rows);
}

export async function buildMonthMovementsCsv(orgId: string, accountId: string, month: string): Promise<string | null> {
  const [[account], totals, movements] = await Promise.all([
    db
      .select({ name: cashAccounts.name, openingBalance: cashAccounts.openingBalance })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.orgId, orgId)))
      .limit(1),
    monthlyTotalsByAccount(orgId, accountId),
    listMonthMovements(orgId, accountId, month),
  ]);
  if (!account) return null;

  const [summary] = liquidate(Number(account.openingBalance), totals.get(accountId) ?? [], [month]);
  const rows = withRunningBalance(summary.opening, movements).map((m) => [
    m.occurredOn,
    m.concept,
    m.document ?? '',
    m.direction === 'in' ? amount(Number(m.amount)) : '',
    m.direction === 'out' ? amount(Number(m.amount)) : '',
    amount(m.balance),
  ]);
  return toCsvDocument(['fecha', 'concepto', 'documento', 'ingreso', 'egreso', 'saldo'], rows);
}
