import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, expenses, payments, properties, units } from '@/lib/db/schema';
import { buildProfitabilityReport } from './profitability';

const INCOME_MOVEMENTS = ['payment', 'partial_payment'];

export type ProfitabilityFilter = { year: number; propertyId?: string };

export async function profitabilityReport(orgId: string, { year, propertyId }: ProfitabilityFilter) {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;

  const [income, spend] = await Promise.all([
    db
      .select({
        propertyId: units.propertyId,
        propertyName: properties.name,
        currency: payments.currency,
        total: sql<number>`coalesce(sum(cast(${payments.amount} as real)), 0)`,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .innerJoin(units, eq(units.id, contracts.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(and(
        eq(payments.orgId, orgId),
        eq(payments.status, 'approved'),
        inArray(payments.movementType, INCOME_MOVEMENTS),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
        propertyId ? eq(units.propertyId, propertyId) : undefined,
      ))
      .groupBy(units.propertyId, properties.name, payments.currency),
    db
      .select({
        propertyId: expenses.propertyId,
        propertyName: properties.name,
        total: sql<number>`coalesce(sum(cast(${expenses.amount} as real)), 0)`,
      })
      .from(expenses)
      .leftJoin(properties, eq(properties.id, expenses.propertyId))
      .where(and(
        eq(expenses.orgId, orgId),
        gte(expenses.incurredOn, from),
        lt(expenses.incurredOn, to),
        propertyId ? eq(expenses.propertyId, propertyId) : undefined,
      ))
      .groupBy(expenses.propertyId, properties.name),
  ]);

  return buildProfitabilityReport(income, spend);
}

export async function propertyOptions(orgId: string) {
  return db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(eq(properties.orgId, orgId))
    .orderBy(asc(properties.name))
    .limit(500);
}
