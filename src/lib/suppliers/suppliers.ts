import { and, asc, count, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { incidents, incidentSupplierAssignments, suppliers } from '@/lib/db/schema';
import type { SupplierInput, UpdateAssignmentInput } from '@/lib/schemas/suppliers';

const OPEN_STATUSES = sql`${incidentSupplierAssignments.status} IN ('assigned','quoted','approved')`;

export async function listSuppliers(orgId: string) {
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      trade: suppliers.trade,
      phone: suppliers.phone,
      email: suppliers.email,
      notes: suppliers.notes,
      active: suppliers.active,
      openJobs: sql<number>`count(case when ${OPEN_STATUSES} then 1 end)`,
      totalJobs: count(incidentSupplierAssignments.id),
    })
    .from(suppliers)
    .leftJoin(incidentSupplierAssignments, eq(incidentSupplierAssignments.supplierId, suppliers.id))
    .where(eq(suppliers.orgId, orgId))
    .groupBy(suppliers.id)
    .orderBy(asc(suppliers.name))
    .limit(500);
}

export async function activeSupplierOptions(orgId: string) {
  return db
    .select({ id: suppliers.id, name: suppliers.name, trade: suppliers.trade })
    .from(suppliers)
    .where(and(eq(suppliers.orgId, orgId), eq(suppliers.active, true)))
    .orderBy(asc(suppliers.name))
    .limit(500);
}

export async function createSupplier(orgId: string, input: SupplierInput) {
  const [row] = await db.insert(suppliers).values({ orgId, ...input }).returning({ id: suppliers.id });
  return row.id;
}

export async function updateSupplier(orgId: string, id: string, input: SupplierInput) {
  const rows = await db
    .update(suppliers)
    .set(input)
    .where(and(eq(suppliers.id, id), eq(suppliers.orgId, orgId)))
    .returning({ id: suppliers.id });
  return rows.length > 0;
}

export async function setSupplierActive(orgId: string, id: string, active: boolean) {
  const rows = await db
    .update(suppliers)
    .set({ active })
    .where(and(eq(suppliers.id, id), eq(suppliers.orgId, orgId)))
    .returning({ id: suppliers.id });
  return rows.length > 0;
}

export async function incidentAssignment(orgId: string, incidentId: string) {
  const [row] = await db
    .select({
      supplierId: incidentSupplierAssignments.supplierId,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      status: incidentSupplierAssignments.status,
      quoteAmount: incidentSupplierAssignments.quoteAmount,
      finalCost: incidentSupplierAssignments.finalCost,
      notes: incidentSupplierAssignments.notes,
    })
    .from(incidentSupplierAssignments)
    .innerJoin(suppliers, eq(suppliers.id, incidentSupplierAssignments.supplierId))
    .where(and(eq(incidentSupplierAssignments.incidentId, incidentId), eq(incidentSupplierAssignments.orgId, orgId)));
  return row ?? null;
}

export async function assignSupplier(orgId: string, userId: string, incidentId: string, supplierId: string) {
  const [[incident], [supplier]] = await Promise.all([
    db.select({ id: incidents.id }).from(incidents).where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId))),
    db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.orgId, orgId), eq(suppliers.active, true))),
  ]);
  if (!incident || !supplier) return false;

  await db
    .insert(incidentSupplierAssignments)
    .values({ orgId, incidentId, supplierId, assignedBy: userId })
    .onConflictDoUpdate({
      target: incidentSupplierAssignments.incidentId,
      set: { supplierId, assignedBy: userId, status: 'assigned', quoteAmount: null, finalCost: null, updatedAt: new Date() },
    });
  return true;
}

export async function updateAssignment(orgId: string, input: UpdateAssignmentInput) {
  const rows = await db
    .update(incidentSupplierAssignments)
    .set({ status: input.status, quoteAmount: input.quote_amount, finalCost: input.final_cost, notes: input.notes })
    .where(and(eq(incidentSupplierAssignments.incidentId, input.incident_id), eq(incidentSupplierAssignments.orgId, orgId)))
    .returning({ id: incidentSupplierAssignments.id });
  return rows.length > 0;
}
