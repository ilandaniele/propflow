import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';

export const MAX_COMPARED_PROPERTIES = 4;
export const COMPARISON_WINDOW_MONTHS = 12;

const PROPERTY_ID = sql.raw('"properties"."id"');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseComparedIds(raw: string | string[] | undefined): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [...new Set(values.filter((v) => GUID.test(v)))].slice(0, MAX_COMPARED_PROPERTIES);
}

export function windowStart(today: string, months = COMPARISON_WINDOW_MONTHS): string {
  const [year, month] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - months + 1, 1));
  return start.toISOString().slice(0, 10);
}

export async function compareProperties(orgId: string, propertyIds: string[], since: string) {
  if (propertyIds.length === 0) return [];
  const rows = await db
    .select({
      id: properties.id,
      name: properties.name,
      totalUnits: sql<number>`(SELECT COUNT(*) FROM units u WHERE u.property_id = ${PROPERTY_ID})`,
      occupiedUnits: sql<number>`(SELECT COUNT(*) FROM units u WHERE u.property_id = ${PROPERTY_ID} AND u.status = 'occupied')`,
      contractedRent: sql<number>`(SELECT COALESCE(SUM(CAST(c.monthly_rent AS REAL)), 0) FROM contracts c
        JOIN units u ON u.id = c.unit_id WHERE u.property_id = ${PROPERTY_ID} AND c.status = 'active')`,
      collected: sql<number>`(SELECT COALESCE(SUM(CAST(p.amount AS REAL)), 0) FROM payments p
        JOIN contracts c ON c.id = p.contract_id JOIN units u ON u.id = c.unit_id
        WHERE u.property_id = ${PROPERTY_ID} AND p.status = 'approved' AND p.paid_at >= ${since})`,
      expenses: sql<number>`(SELECT COALESCE(SUM(CAST(e.amount AS REAL)), 0) FROM expenses e
        WHERE e.property_id = ${PROPERTY_ID} AND e.incurred_on >= ${since})`,
      openIncidents: sql<number>`(SELECT COUNT(*) FROM incidents i WHERE i.property_id = ${PROPERTY_ID} AND i.status <> 'solved')`,
    })
    .from(properties)
    .where(and(eq(properties.orgId, orgId), inArray(properties.id, propertyIds)))
    .orderBy(asc(properties.name));

  return rows.map((r) => {
    const totalUnits = Number(r.totalUnits);
    const occupiedUnits = Number(r.occupiedUnits);
    const collected = Number(r.collected);
    const expenses = Number(r.expenses);
    return {
      id: r.id,
      name: r.name,
      totalUnits,
      occupiedUnits,
      occupancyPct: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0,
      contractedRent: Number(r.contractedRent),
      collected,
      expenses,
      net: collected - expenses,
      openIncidents: Number(r.openIncidents),
    };
  });
}

export type PropertyComparison = Awaited<ReturnType<typeof compareProperties>>[number];

export function listPropertyOptions(orgId: string) {
  return db.select({ id: properties.id, name: properties.name }).from(properties)
    .where(eq(properties.orgId, orgId)).orderBy(asc(properties.name)).limit(500);
}
