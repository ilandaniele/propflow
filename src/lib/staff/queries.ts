import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { buildingStaff, properties } from '@/lib/db/schema';

const STAFF_LIMIT = 200;

export function listStaff(orgId: string) {
  return db
    .select({
      id:             buildingStaff.id,
      fullName:       buildingStaff.fullName,
      position:       buildingStaff.position,
      shift:          buildingStaff.shift,
      phone:          buildingStaff.phone,
      documentNumber: buildingStaff.documentNumber,
      propertyName:   properties.name,
    })
    .from(buildingStaff)
    .leftJoin(properties, eq(properties.id, buildingStaff.propertyId))
    .where(eq(buildingStaff.orgId, orgId))
    .orderBy(asc(buildingStaff.position), asc(buildingStaff.fullName))
    .limit(STAFF_LIMIT);
}

export async function listStaffDirectory(orgId: string) {
  const rows = await listStaff(orgId);
  return rows.map(({ id, fullName, position, shift, propertyName }) => ({ id, fullName, position, shift, propertyName }));
}

export async function propertyBelongsToOrg(orgId: string, propertyId: string) {
  const rows = await db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function insertStaffMember(values: typeof buildingStaff.$inferInsert) {
  await db.insert(buildingStaff).values(values);
}

export async function deleteStaffMember(orgId: string, id: string) {
  const rows = await db.delete(buildingStaff)
    .where(and(eq(buildingStaff.id, id), eq(buildingStaff.orgId, orgId)))
    .returning({ id: buildingStaff.id });
  return rows.length > 0;
}
