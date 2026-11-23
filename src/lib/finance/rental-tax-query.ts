import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, payments, properties, units } from '@/lib/db/schema';
import type { RentalIncomeRow } from './rental-tax';

const RENT_MOVEMENTS = ['payment', 'partial_payment'];

export async function rentalIncomeByMonth(orgId: string, year: number): Promise<RentalIncomeRow[]> {
  const month = sql<number>`cast(substr(${payments.paidAt}, 6, 2) as integer)`;
  const rows = await db
    .select({
      propertyId: properties.id,
      propertyName: properties.name,
      currency: payments.currency,
      month,
      amount: sql<number>`sum(cast(${payments.amount} as real))`,
    })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(
      eq(payments.orgId, orgId),
      eq(payments.status, 'approved'),
      inArray(payments.movementType, RENT_MOVEMENTS),
      gte(payments.paidAt, `${year}-01-01`),
      lt(payments.paidAt, `${year + 1}-01-01`),
    ))
    .groupBy(properties.id, properties.name, payments.currency, month);
  return rows.map((row) => ({ ...row, month: Number(row.month), amount: Number(row.amount) }));
}
