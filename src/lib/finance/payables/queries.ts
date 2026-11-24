import { and, asc, eq, gte, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expenseCategories, payablePayments, payables, properties } from '@/lib/db/schema';
import { MAX_PAGE_SIZE } from '@/lib/pagination';
import type { PayableFilters } from '@/lib/schemas/payables';
import { derivePayableStatus, saldoCents, type PayableStatus } from './status';

export const PAYABLES_PAGE_SIZE = Math.min(25, MAX_PAGE_SIZE);

const centsOf = (column: AnyColumn) => sql`ROUND(CAST(${column} AS REAL) * 100)`;

function balances(orgId: string) {
  return db
    .select({
      id: payables.id,
      supplierName: payables.supplierName,
      description: payables.description,
      documentRef: payables.documentRef,
      issuedOn: payables.issuedOn,
      dueOn: payables.dueOn,
      propertyName: sql<string | null>`${properties.name}`.as('property_name'),
      categoryName: sql<string | null>`${expenseCategories.name}`.as('category_name'),
      amountCents: sql<number>`${centsOf(payables.amount)}`.as('amount_cents'),
      paidCents: sql<number>`COALESCE(SUM(${centsOf(payablePayments.amount)}), 0)`.as('paid_cents'),
    })
    .from(payables)
    .leftJoin(payablePayments, eq(payablePayments.payableId, payables.id))
    .leftJoin(properties, eq(properties.id, payables.propertyId))
    .leftJoin(expenseCategories, eq(expenseCategories.id, payables.categoryId))
    .where(eq(payables.orgId, orgId))
    .groupBy(payables.id)
    .as('balances');
}

type Balances = ReturnType<typeof balances>;

function saldoSql(b: Balances) {
  return sql`(${b.amountCents} - ${b.paidCents})`;
}

function statusCondition(b: Balances, status: PayableStatus, today: string): SQL {
  const saldo = saldoSql(b);
  switch (status) {
    case 'paid': return sql`${saldo} <= 0`;
    case 'overdue': return sql`${saldo} > 0 AND ${b.dueOn} < ${today}`;
    case 'partial': return sql`${saldo} > 0 AND ${b.dueOn} >= ${today} AND ${b.paidCents} > 0`;
    case 'pending': return sql`${saldo} > 0 AND ${b.dueOn} >= ${today} AND ${b.paidCents} = 0`;
  }
}

export type PayableRow = {
  id: string;
  supplierName: string;
  description: string | null;
  documentRef: string | null;
  propertyName: string | null;
  categoryName: string | null;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  paidCents: number;
  saldoCents: number;
  status: PayableStatus;
};

export async function listPayables(
  orgId: string,
  filters: PayableFilters,
  today: string,
): Promise<{ items: PayableRow[]; total: number }> {
  const b = balances(orgId);
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(statusCondition(b, filters.status, today));
  if (filters.due_from) conditions.push(gte(b.dueOn, filters.due_from));
  if (filters.due_to) conditions.push(lte(b.dueOn, filters.due_to));

  const rows = await db
    .select({
      id: b.id,
      supplierName: b.supplierName,
      description: b.description,
      documentRef: b.documentRef,
      propertyName: b.propertyName,
      categoryName: b.categoryName,
      issuedOn: b.issuedOn,
      dueOn: b.dueOn,
      amountCents: b.amountCents,
      paidCents: b.paidCents,
      total: sql<number>`COUNT(*) OVER ()`,
    })
    .from(b)
    .where(and(...conditions))
    .orderBy(asc(b.dueOn), asc(b.id))
    .limit(PAYABLES_PAGE_SIZE)
    .offset((filters.page - 1) * PAYABLES_PAGE_SIZE);

  const items = rows.map(({ total: _total, ...row }) => {
    const amountCents = Number(row.amountCents);
    const paidCents = Number(row.paidCents);
    return {
      ...row,
      amountCents,
      paidCents,
      saldoCents: saldoCents(amountCents, paidCents),
      status: derivePayableStatus({ amountCents, paidCents, dueOn: row.dueOn, today }),
    };
  });
  return { items, total: Number(rows[0]?.total ?? 0) };
}

export async function payablesSummary(
  orgId: string,
  today: string,
): Promise<{ pendingCents: number; overdueCents: number }> {
  const b = balances(orgId);
  const saldo = saldoSql(b);
  const [row] = await db
    .select({
      pendingCents: sql<number>`COALESCE(SUM(MAX(${saldo}, 0)), 0)`,
      overdueCents: sql<number>`COALESCE(SUM(CASE WHEN ${saldo} > 0 AND ${b.dueOn} < ${today} THEN ${saldo} ELSE 0 END), 0)`,
    })
    .from(b);
  return { pendingCents: Number(row?.pendingCents ?? 0), overdueCents: Number(row?.overdueCents ?? 0) };
}

export async function payableSaldoCents(orgId: string, payableId: string): Promise<number | null> {
  const [row] = await db
    .select({
      amountCents: sql<number>`${centsOf(payables.amount)}`,
      paidCents: sql<number>`COALESCE(SUM(${centsOf(payablePayments.amount)}), 0)`,
    })
    .from(payables)
    .leftJoin(payablePayments, eq(payablePayments.payableId, payables.id))
    .where(and(eq(payables.id, payableId), eq(payables.orgId, orgId)))
    .groupBy(payables.id);
  if (!row) return null;
  return saldoCents(Number(row.amountCents), Number(row.paidCents));
}
