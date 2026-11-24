import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tenants, unitBeds, units } from '@/lib/db/schema';

export async function listUnitBeds(orgId: string, unitId: string) {
  return db
    .select({
      id: unitBeds.id,
      label: unitBeds.label,
      monthlyRent: unitBeds.monthlyRent,
      tenantId: unitBeds.tenantId,
      tenantName: tenants.fullName,
    })
    .from(unitBeds)
    .leftJoin(tenants, and(eq(tenants.id, unitBeds.tenantId), eq(tenants.orgId, orgId)))
    .where(and(eq(unitBeds.orgId, orgId), eq(unitBeds.unitId, unitId)))
    .orderBy(asc(unitBeds.label))
    .limit(100);
}

export type UnitBedRow = Awaited<ReturnType<typeof listUnitBeds>>[number];

export async function unitBelongsToOrg(orgId: string, unitId: string): Promise<boolean> {
  const rows = await db.select({ id: units.id }).from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function tenantBelongsToOrg(orgId: string, tenantId: string): Promise<boolean> {
  const rows = await db.select({ id: tenants.id }).from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function bedLabelTaken(unitId: string, label: string): Promise<boolean> {
  const rows = await db.select({ id: unitBeds.id }).from(unitBeds)
    .where(and(eq(unitBeds.unitId, unitId), eq(unitBeds.label, label))).limit(1);
  return rows.length > 0;
}

export async function tenantHasOtherBed(tenantId: string, bedId: string): Promise<boolean> {
  const rows = await db.select({ id: unitBeds.id }).from(unitBeds)
    .where(and(eq(unitBeds.tenantId, tenantId), ne(unitBeds.id, bedId))).limit(1);
  return rows.length > 0;
}

export async function insertUnitBed(orgId: string, unitId: string, label: string, monthlyRent?: number): Promise<void> {
  await db.insert(unitBeds).values({
    orgId,
    unitId,
    label,
    monthlyRent: monthlyRent === undefined ? null : monthlyRent.toFixed(2),
  });
}

/** Returns the bed's unit id, or null when the bed is not in this org. */
export async function assignUnitBedTenant(orgId: string, id: string, tenantId: string | null): Promise<string | null> {
  const rows = await db.update(unitBeds)
    .set({ tenantId, updatedAt: new Date() })
    .where(and(eq(unitBeds.id, id), eq(unitBeds.orgId, orgId)))
    .returning({ unitId: unitBeds.unitId });
  return rows[0]?.unitId ?? null;
}

/** Returns the bed's unit id, or null when the bed is not in this org. */
export async function deleteUnitBed(orgId: string, id: string): Promise<string | null> {
  const rows = await db.delete(unitBeds)
    .where(and(eq(unitBeds.id, id), eq(unitBeds.orgId, orgId)))
    .returning({ unitId: unitBeds.unitId });
  return rows[0]?.unitId ?? null;
}

export async function listTenantOptions(orgId: string) {
  return db.select({ id: tenants.id, name: tenants.fullName }).from(tenants)
    .where(eq(tenants.orgId, orgId))
    .orderBy(asc(tenants.fullName))
    .limit(500);
}
