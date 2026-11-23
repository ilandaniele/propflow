import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { charges, einvoiceSeries, einvoices, tenants } from '@/lib/db/schema';
import type { Amounts, CustomerDocType, DocType } from './calc';
import type { EmitResult, ProviderName } from './providers';

export const EINVOICE_PAGE_SIZE = 50;
const EMITTABLE_CHARGES_LIMIT = 100;

export async function listEinvoices(orgId: string, page: number) {
  const rows = await db.select({
    id: einvoices.id,
    docType: einvoices.docType,
    series: einvoices.series,
    number: einvoices.number,
    customerName: einvoices.customerName,
    customerDocNumber: einvoices.customerDocNumber,
    total: einvoices.total,
    igv: einvoices.igv,
    provider: einvoices.provider,
    status: einvoices.status,
    pdfUrl: einvoices.pdfUrl,
    error: einvoices.error,
    createdAt: einvoices.createdAt,
  })
    .from(einvoices)
    .where(eq(einvoices.orgId, orgId))
    .orderBy(desc(einvoices.createdAt), desc(einvoices.id))
    .limit(EINVOICE_PAGE_SIZE + 1)
    .offset((page - 1) * EINVOICE_PAGE_SIZE);
  return { items: rows.slice(0, EINVOICE_PAGE_SIZE), hasMore: rows.length > EINVOICE_PAGE_SIZE };
}

export function listEmittableCharges(orgId: string) {
  return db.select({
    id: charges.id,
    amount: charges.amount,
    period: charges.period,
    description: charges.description,
    tenantName: tenants.fullName,
    tenantDni: tenants.dni,
  })
    .from(charges)
    .innerJoin(tenants, eq(tenants.id, charges.tenantId))
    .leftJoin(einvoices, eq(einvoices.chargeId, charges.id))
    .where(and(eq(charges.orgId, orgId), isNull(einvoices.id)))
    .orderBy(desc(charges.dueDate), desc(charges.createdAt))
    .limit(EMITTABLE_CHARGES_LIMIT);
}

export async function findChargeForEinvoice(orgId: string, chargeId: string) {
  const [row] = await db.select({
    id: charges.id,
    amount: charges.amount,
    period: charges.period,
    description: charges.description,
    einvoiceId: einvoices.id,
  })
    .from(charges)
    .leftJoin(einvoices, eq(einvoices.chargeId, charges.id))
    .where(and(eq(charges.id, chargeId), eq(charges.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export interface EinvoiceDraft extends Amounts {
  orgId: string;
  chargeId: string;
  docType: DocType;
  series: string;
  customerDocType: CustomerDocType;
  customerDocNumber: string | null;
  customerName: string;
  provider: ProviderName;
}

export async function reserveEinvoice(draft: EinvoiceDraft): Promise<{ id: string; number: number }> {
  const seriesKey = and(
    eq(einvoiceSeries.orgId, draft.orgId),
    eq(einvoiceSeries.docType, draft.docType),
    eq(einvoiceSeries.series, draft.series),
  );
  const [, , inserted] = await db.batch([
    db.insert(einvoiceSeries)
      .values({ orgId: draft.orgId, docType: draft.docType, series: draft.series })
      .onConflictDoNothing(),
    db.update(einvoiceSeries)
      .set({ nextNumber: sql`${einvoiceSeries.nextNumber} + 1` })
      .where(seriesKey),
    db.insert(einvoices)
      .values({
        ...draft,
        number: sql`(SELECT ${einvoiceSeries.nextNumber} - 1 FROM ${einvoiceSeries} WHERE ${seriesKey})`,
      })
      .returning({ id: einvoices.id, number: einvoices.number }),
  ]);
  return inserted[0];
}

export async function saveEmitResult(id: string, result: EmitResult) {
  await db.update(einvoices)
    .set({ ...result, updatedAt: new Date() })
    .where(eq(einvoices.id, id));
}
