/**
 * POST /api/admin/payments/import
 * Upserts validated payment rows (admin — can set any tenant/status).
 *
 * payments.contract_id is NOT NULL but CSV imports do not supply it: each row is
 * attached to its tenant's latest active contract in this org, and rows whose
 * tenant has none are skipped.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, tenants, contracts, payments } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const PAYMENT_ROWS_PER_INSERT = rowsPerInsert(payments);
const LOOKUP_IDS_PER_QUERY = 90;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  let formData: FormData;
  try { formData = await request.formData(); } catch {
    return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Expected multipart/form-data.' } }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: { code: 'MISSING_FILE', message: 'No se recibió archivo CSV.' } }, { status: 400 });
  }
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: { code: 'FILE_TOO_LARGE', message: 'El archivo excede 5 MB.' } }, { status: 400 });
  }

  const csvText = await file.text();
  const { rows, errors } = parsePaymentsCsv(csvText);

  // Build tenant email → id map for this org — Drizzle (AC1, AC8)
  const tenantEmails = [...new Set(rows.map(r => r.tenant_email).filter(Boolean))] as string[];
  const tenantEmailMap: Record<string, string> = {};
  const tenantRows = (await Promise.all(
    chunk(tenantEmails, LOOKUP_IDS_PER_QUERY).map((part) => db
      .select({ id: tenants.id, email: tenants.email })
      .from(tenants)
      .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email!, part)))),
  )).flat();
  tenantRows.forEach(t => { if (t.email) tenantEmailMap[t.email] = t.id; });

  const tenantIdOf = (row: (typeof rows)[number]) =>
    row.tenant_id ?? (row.tenant_email ? tenantEmailMap[row.tenant_email] : undefined);

  // Latest active contract per tenant, org scoped (AC8)
  const tenantIds = [...new Set(rows.map(tenantIdOf).filter(Boolean))] as string[];
  const contractRows = (await Promise.all(
    chunk(tenantIds, LOOKUP_IDS_PER_QUERY).map((part) => db
      .select({ id: contracts.id, tenantId: contracts.tenantId, createdAt: contracts.createdAt })
      .from(contracts)
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'), inArray(contracts.tenantId, part)))),
  )).flat();
  const contractByTenant = new Map<string, string>();
  contractRows
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .forEach(c => { if (!contractByTenant.has(c.tenantId)) contractByTenant.set(c.tenantId, c.id); });

  // Create import log — Drizzle (AC1)
  const logRows = await db
    .insert(importLogs)
    .values({
      orgId:        ctx.orgId,
      importType:   'payment',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'admin',
      status:       'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    })
    .returning({ id: importLogs.id });

  if (logRows.length === 0) {
    console.error('[api/admin/payments/import POST] log insert failed');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = logRows[0].id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  const now = new Date();
  const upserts: (typeof payments.$inferInsert)[] = [];
  const inserts: (typeof payments.$inferInsert)[] = [];

  for (const row of rows) {
    const tenant_id = tenantIdOf(row);
    const contract_id = tenant_id ? contractByTenant.get(tenant_id) : undefined;
    if (!tenant_id || !contract_id) { skipped++; continue; }

    (row.external_payment_id ? upserts : inserts).push({
      id:                crypto.randomUUID(),
      orgId:             ctx.orgId,
      contractId:        contract_id,
      tenantId:          tenant_id,
      amount:            String(row.amount),
      currency:          row.currency ?? 'PEN',
      paidAt:            row.payment_date,
      status:            row.status,
      method:            row.payment_method ?? 'transfer',
      reference:         row.reference ?? null,
      movementType:      'payment',
      externalPaymentId: row.external_payment_id ?? null,
      importSource:      'csv_import',
      importId:          import_id,
      createdAt:         now,
      updatedAt:         now,
    });
  }

  // One D1 batch is atomic: every chunk lands or none does.
  const batch = asBatch([
    ...chunk(upserts, PAYMENT_ROWS_PER_INSERT).map((part) =>
      db.insert(payments).values(part).onConflictDoUpdate({
        target: [payments.orgId, payments.externalPaymentId],
        set: {
          amount:    sql`excluded.amount`,
          status:    sql`excluded.status`,
          paidAt:    sql`excluded.paid_at`,
          importId:  sql`excluded.import_id`,
          updatedAt: now,
        },
      })),
    ...chunk(inserts, PAYMENT_ROWS_PER_INSERT).map((part) => db.insert(payments).values(part)),
  ]);

  if (batch) {
    try {
      await db.batch(batch);
      updated = upserts.length;
      created = inserts.length;
    } catch {
      failed = upserts.length + inserts.length;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await db
    .update(importLogs)
    .set({
      status:      finalStatus,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      rowsFailed:  failed,
      completedAt: new Date(),
    })
    .where(eq(importLogs.id, import_id));

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
