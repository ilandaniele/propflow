import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { charges, payments, tenants } from '@/lib/db/schema';
import { computeAging, type TenantAging } from './aging';

export interface TenantAgingRow extends TenantAging {
  tenantName: string;
}

export async function loadAging(orgId: string, today: string): Promise<TenantAgingRow[]> {
  const [overdueCharges, paidRows] = await Promise.all([
    db
      .select({ tenantId: charges.tenantId, amount: charges.amount, dueDate: charges.dueDate, tenantName: tenants.fullName })
      .from(charges)
      .innerJoin(tenants, eq(tenants.id, charges.tenantId))
      .where(and(eq(charges.orgId, orgId), isNotNull(charges.dueDate), lt(charges.dueDate, today))),
    db
      .select({ tenantId: payments.tenantId, paid: sql<number>`sum(${payments.amount})` })
      .from(payments)
      .where(and(eq(payments.orgId, orgId), eq(payments.status, 'approved')))
      .groupBy(payments.tenantId),
  ]);

  const names = new Map(overdueCharges.map((row) => [row.tenantId, row.tenantName]));
  const paidByTenant = new Map(paidRows.map((row) => [row.tenantId, Number(row.paid)]));
  const aging = computeAging(
    overdueCharges.map((row) => ({ tenantId: row.tenantId, amount: Number(row.amount), dueDate: row.dueDate as string })),
    paidByTenant,
    today,
  );
  return aging.map((row) => ({ ...row, tenantName: names.get(row.tenantId) ?? '' }));
}
