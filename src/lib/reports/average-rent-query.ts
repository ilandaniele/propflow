import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, properties, units } from '@/lib/db/schema';
import { BASE_CURRENCY } from '@/lib/finance/currency';
import { summarizeAverageRent } from './average-rent';

const CONTRACT_CURRENCY = BASE_CURRENCY;

export async function loadAverageRent(orgId: string) {
  const rows = await db
    .select({
      propertyId: properties.id,
      propertyName: properties.name,
      unitType: units.unitType,
      bedrooms: units.bedrooms,
      contracts: sql<number>`count(*)`,
      rentSum: sql<number>`sum(CAST(${contracts.monthlyRent} AS REAL))`,
    })
    .from(contracts)
    .innerJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .innerJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, orgId)))
    .where(and(eq(contracts.orgId, orgId), eq(contracts.status, 'active')))
    .groupBy(properties.id, properties.name, units.unitType, units.bedrooms);

  return summarizeAverageRent(rows.map((row) => ({
    ...row,
    currency: CONTRACT_CURRENCY,
    contracts: Number(row.contracts),
    rentSum: Number(row.rentSum ?? 0),
  })));
}
