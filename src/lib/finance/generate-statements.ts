import { and, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { accountStatements, charges, contracts, payments } from '@/lib/db/schema';
import { buildStatement, statementCode, statementMonthBounds } from './monthly-statement';

export interface StatementRun {
  orgId: string;
  month: string;
  issueDate: string;
  dueDate: string;
}

const amount = sql`CAST(${charges.amount} AS REAL)`;

function chargeTotals(orgId: string, first: string, last: string) {
  const thisMonth = sql`${charges.period} BETWEEN ${first} AND ${last}`;
  const before = sql`COALESCE(${charges.period}, '') < ${first}`;
  const isRent = sql`${charges.kind} = 'rent'`;
  return db
    .select({
      contractId: charges.contractId,
      rentThisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${isRent} AND ${thisMonth} THEN ${amount} END), 0)`,
      extrasThisMonth: sql<number>`COALESCE(SUM(CASE WHEN NOT COALESCE(${isRent}, 0) AND ${thisMonth} THEN ${amount} END), 0)`,
      rentBefore: sql<number>`COALESCE(SUM(CASE WHEN ${isRent} AND ${before} THEN ${amount} END), 0)`,
      extrasBefore: sql<number>`COALESCE(SUM(CASE WHEN NOT COALESCE(${isRent}, 0) AND ${before} THEN ${amount} END), 0)`,
    })
    .from(charges)
    .where(eq(charges.orgId, orgId))
    .groupBy(charges.contractId);
}

function paidTotals(orgId: string) {
  return db
    .select({ contractId: payments.contractId, paid: sql<number>`COALESCE(SUM(CAST(${payments.amount} AS REAL)), 0)` })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), eq(payments.status, 'approved')))
    .groupBy(payments.contractId);
}

export async function generateStatements({ orgId, month, issueDate, dueDate }: StatementRun): Promise<{ created: number; skipped: number }> {
  const { first, last } = statementMonthBounds(month);
  const [year, monthNumber] = month.split('-');

  const [activeContracts, chargeRows, paidRows, existing] = await Promise.all([
    db
      .select({ id: contracts.id, contractCode: contracts.contractCode })
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), eq(contracts.status, 'active'), lte(contracts.startDate, last))),
    chargeTotals(orgId, first, last),
    paidTotals(orgId),
    db
      .select({ contractId: accountStatements.contractId })
      .from(accountStatements)
      .where(and(eq(accountStatements.orgId, orgId), eq(accountStatements.anio, Number(year)), eq(accountStatements.mes, monthNumber))),
  ]);

  const chargesByContract = new Map(chargeRows.map((row) => [row.contractId, row]));
  const paidByContract = new Map(paidRows.map((row) => [row.contractId, Number(row.paid)]));
  const alreadyIssued = new Set(existing.map((row) => row.contractId));

  const rows = activeContracts
    .filter((contract) => !alreadyIssued.has(contract.id))
    .map((contract) => {
      const totals = chargesByContract.get(contract.id);
      const statement = buildStatement({
        rentThisMonth: Number(totals?.rentThisMonth ?? 0),
        extrasThisMonth: Number(totals?.extrasThisMonth ?? 0),
        rentBefore: Number(totals?.rentBefore ?? 0),
        extrasBefore: Number(totals?.extrasBefore ?? 0),
        paid: paidByContract.get(contract.id) ?? 0,
      });
      return {
        orgId,
        contractId: contract.id,
        eeccCode: statementCode(month, contract.contractCode, contract.id),
        mes: monthNumber,
        anio: Number(year),
        issueDate,
        dueDate,
        rentAmount: statement.rentAmount.toFixed(2),
        additionalSubtotal: statement.additionalSubtotal.toFixed(2),
        previousRentBalance: statement.previousRentBalance.toFixed(2),
        previousAddlBalance: statement.previousAddlBalance.toFixed(2),
        totalDue: statement.totalDue.toFixed(2),
        sendStatus: 'draft',
      };
    });

  const batch = asBatch(chunk(rows, rowsPerInsert(accountStatements)).map((part) => db.insert(accountStatements).values(part)));
  if (batch) await db.batch(batch);
  return { created: rows.length, skipped: alreadyIssued.size };
}
