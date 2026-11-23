import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authorizedVisitors, contracts, tenants, units, visitorLogs } from '@/lib/db/schema';

export async function findTenantActiveUnit(orgId: string, profileId: string) {
  const rows = await db
    .select({ tenantId: tenants.id, unitId: contracts.unitId })
    .from(tenants)
    .innerJoin(contracts, and(eq(contracts.tenantId, tenants.id), eq(contracts.orgId, orgId), eq(contracts.status, 'active')))
    .where(and(eq(tenants.profileId, profileId), eq(tenants.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function unitBelongsToOrg(orgId: string, unitId: string) {
  const rows = await db.select({ id: units.id }).from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function listVisitorLogs(orgId: string, filter: { unitId?: string; passphrase?: string } = {}) {
  return db
    .select({
      id:          visitorLogs.id,
      visitorName: visitorLogs.visitorName,
      visitDate:   visitorLogs.visitDate,
      entryTime:   visitorLogs.entryTime,
      exitTime:    visitorLogs.exitTime,
      purpose:     visitorLogs.purpose,
      passphrase:  visitorLogs.passphrase,
      unitLabel:   units.label,
    })
    .from(visitorLogs)
    .leftJoin(units, eq(units.id, visitorLogs.unitId))
    .where(and(
      eq(visitorLogs.orgId, orgId),
      filter.unitId ? eq(visitorLogs.unitId, filter.unitId) : undefined,
      filter.passphrase ? eq(visitorLogs.passphrase, filter.passphrase) : undefined,
    ))
    .orderBy(desc(visitorLogs.visitDate), desc(visitorLogs.createdAt))
    .limit(50);
}

export async function listAuthorizedVisitors(orgId: string, unitId?: string) {
  return db
    .select({
      id:             authorizedVisitors.id,
      fullName:       authorizedVisitors.fullName,
      documentNumber: authorizedVisitors.documentNumber,
      relationship:   authorizedVisitors.relationship,
      unitLabel:      units.label,
    })
    .from(authorizedVisitors)
    .innerJoin(units, eq(units.id, authorizedVisitors.unitId))
    .where(and(eq(authorizedVisitors.orgId, orgId), unitId ? eq(authorizedVisitors.unitId, unitId) : undefined))
    .orderBy(units.label, authorizedVisitors.fullName)
    .limit(200);
}

export async function insertAuthorizedVisitor(values: typeof authorizedVisitors.$inferInsert) {
  await db.insert(authorizedVisitors).values(values);
}

export async function deleteAuthorizedVisitor(orgId: string, id: string, unitId?: string) {
  const rows = await db
    .delete(authorizedVisitors)
    .where(and(
      eq(authorizedVisitors.id, id),
      eq(authorizedVisitors.orgId, orgId),
      unitId ? eq(authorizedVisitors.unitId, unitId) : undefined,
    ))
    .returning({ id: authorizedVisitors.id });
  return rows.length > 0;
}
