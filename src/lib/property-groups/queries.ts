import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { properties, propertyGroupMembers, propertyGroups } from '@/lib/db/schema';
import type { PropertyComparison } from '@/lib/properties/comparison';

type GroupMember = { id: string; name: string };

export async function listPropertyGroups(orgId: string) {
  const rows = await db
    .select({
      id: propertyGroups.id,
      name: propertyGroups.name,
      members: sql<string>`(SELECT json_group_array(json_object('id', p.id, 'name', p.name)) FROM property_group_members m
        JOIN properties p ON p.id = m.property_id WHERE m.group_id = "property_groups"."id")`,
    })
    .from(propertyGroups)
    .where(eq(propertyGroups.orgId, orgId))
    .orderBy(asc(propertyGroups.name))
    .limit(200);
  return rows.map((r) => ({ id: r.id, name: r.name, members: JSON.parse(r.members ?? '[]') as GroupMember[] }));
}

export type PropertyGroupRow = Awaited<ReturnType<typeof listPropertyGroups>>[number];

export async function propertiesBelongToOrg(orgId: string, propertyIds: string[]): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(properties)
    .where(and(eq(properties.orgId, orgId), inArray(properties.id, propertyIds)));
  return Number(row?.n ?? 0) === new Set(propertyIds).size;
}

export async function groupNameTaken(orgId: string, name: string): Promise<boolean> {
  const rows = await db.select({ id: propertyGroups.id }).from(propertyGroups)
    .where(and(eq(propertyGroups.orgId, orgId), eq(propertyGroups.name, name))).limit(1);
  return rows.length > 0;
}

export async function insertPropertyGroup(orgId: string, name: string, propertyIds: string[]): Promise<void> {
  const groupId = crypto.randomUUID();
  await db.batch([
    db.insert(propertyGroups).values({ id: groupId, orgId, name }),
    db.insert(propertyGroupMembers).values([...new Set(propertyIds)].map((propertyId) => ({ groupId, propertyId }))),
  ]);
}

export async function deletePropertyGroup(orgId: string, id: string): Promise<boolean> {
  const rows = await db.delete(propertyGroups)
    .where(and(eq(propertyGroups.id, id), eq(propertyGroups.orgId, orgId)))
    .returning({ id: propertyGroups.id });
  return rows.length > 0;
}

type Totals = Omit<PropertyComparison, 'id' | 'name'>;

export function sumComparisons(rows: PropertyComparison[]): Totals {
  const totals = rows.reduce(
    (acc, r) => ({
      totalUnits: acc.totalUnits + r.totalUnits,
      occupiedUnits: acc.occupiedUnits + r.occupiedUnits,
      contractedRent: acc.contractedRent + r.contractedRent,
      collected: acc.collected + r.collected,
      expenses: acc.expenses + r.expenses,
      openIncidents: acc.openIncidents + r.openIncidents,
    }),
    { totalUnits: 0, occupiedUnits: 0, contractedRent: 0, collected: 0, expenses: 0, openIncidents: 0 },
  );
  return {
    ...totals,
    occupancyPct: totals.totalUnits > 0 ? Math.round((totals.occupiedUnits / totals.totalUnits) * 100) : 0,
    net: totals.collected - totals.expenses,
  };
}
