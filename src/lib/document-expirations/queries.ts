import { and, asc, count, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expiringDocuments, properties, tenants } from '@/lib/db/schema';
import { ALERT_WINDOW_DAYS, addDays } from './status';

export function listExpiringDocuments(orgId: string) {
  return db
    .select({
      id: expiringDocuments.id,
      kind: expiringDocuments.kind,
      label: expiringDocuments.label,
      expiresOn: expiringDocuments.expiresOn,
      tenantName: tenants.fullName,
      propertyName: properties.name,
    })
    .from(expiringDocuments)
    .leftJoin(tenants, eq(tenants.id, expiringDocuments.tenantId))
    .leftJoin(properties, eq(properties.id, expiringDocuments.propertyId))
    .where(eq(expiringDocuments.orgId, orgId))
    .orderBy(asc(expiringDocuments.expiresOn))
    .limit(200);
}

export type ExpiringDocumentRow = Awaited<ReturnType<typeof listExpiringDocuments>>[number];

export async function listSubjectOptions(orgId: string) {
  const [tenantRows, propertyRows] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.fullName }).from(tenants)
      .where(eq(tenants.orgId, orgId)).orderBy(asc(tenants.fullName)).limit(500),
    db.select({ id: properties.id, name: properties.name }).from(properties)
      .where(eq(properties.orgId, orgId)).orderBy(asc(properties.name)).limit(500),
  ]);
  return { tenants: tenantRows, properties: propertyRows };
}

export type SubjectOption = { id: string; name: string | null };

export async function subjectsBelongToOrg(orgId: string, refs: { tenantId?: string; propertyId?: string }): Promise<boolean> {
  const [tenant, property] = await Promise.all([
    refs.tenantId
      ? db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, refs.tenantId), eq(tenants.orgId, orgId))).limit(1)
      : Promise.resolve([{ id: '' }]),
    refs.propertyId
      ? db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, refs.propertyId), eq(properties.orgId, orgId))).limit(1)
      : Promise.resolve([{ id: '' }]),
  ]);
  return tenant.length > 0 && property.length > 0;
}

export async function insertExpiringDocument(values: typeof expiringDocuments.$inferInsert): Promise<void> {
  await db.insert(expiringDocuments).values(values);
}

export async function deleteExpiringDocument(orgId: string, id: string): Promise<boolean> {
  const rows = await db.delete(expiringDocuments)
    .where(and(eq(expiringDocuments.id, id), eq(expiringDocuments.orgId, orgId)))
    .returning({ id: expiringDocuments.id });
  return rows.length > 0;
}

export async function countExpiringDocuments(orgId: string, today: string): Promise<{ expired: number; soon: number }> {
  const [row] = await db
    .select({
      expired: sql<number>`coalesce(sum(case when ${expiringDocuments.expiresOn} < ${today} then 1 else 0 end), 0)`,
      due: count(),
    })
    .from(expiringDocuments)
    .where(and(eq(expiringDocuments.orgId, orgId), lte(expiringDocuments.expiresOn, addDays(today, ALERT_WINDOW_DAYS))));
  const expired = Number(row?.expired ?? 0);
  return { expired, soon: Number(row?.due ?? 0) - expired };
}
