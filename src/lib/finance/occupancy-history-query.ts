import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, properties, units } from '@/lib/db/schema';
import { buildOccupancyHistory } from './occupancy-history';

export async function occupancyHistory(orgId: string, year: number, today = new Date().toISOString().slice(0, 10)) {
  const stayEnd = sql<string | null>`coalesce(${contracts.actualExitDate}, ${contracts.endDate})`;
  const [unitRows, stays] = await Promise.all([
    db
      .select({ id: units.id, propertyId: units.propertyId, propertyName: properties.name })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(eq(units.orgId, orgId)),
    db
      .select({ unitId: contracts.unitId, start: contracts.startDate, end: stayEnd })
      .from(contracts)
      .where(and(
        eq(contracts.orgId, orgId),
        lte(contracts.startDate, `${year}-12-31`),
        or(isNull(stayEnd), gte(stayEnd, `${year}-01-01`)),
        or(isNull(contracts.signatureStatus), ne(contracts.signatureStatus, 'declined')),
      )),
  ]);

  return buildOccupancyHistory({ units: unitRows, stays, year, today });
}
