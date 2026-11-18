/**
 * POST /api/tenant/payments/import
 * Upserts validated payment rows for the authenticated tenant.
 * Tenant-imported payments are set to status='under_review'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { profiles, tenants, importLogs, contracts, payments } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const PAYMENT_ROWS_PER_INSERT = rowsPerInsert(payments);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
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

  // Get profile for email security check — Drizzle (AC1, AC8: orgId scoped)
  const profileRows = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(and(eq(profiles.userId, ctx.userId), eq(profiles.orgId, ctx.orgId)))
    .limit(1);

  const tenantEmail = (profileRows[0]?.email ?? '').trim().toLowerCase();

  // Get tenant record — Drizzle (AC1, AC8: profileId + orgId scoped)
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const tenantRecord = tenantRows[0];
  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  // Create import log — Drizzle (AC1)
  const importLogRows = await db
    .insert(importLogs)
    .values({
      orgId: ctx.orgId,
      importType: 'payment',
      fileName: file.name,
      importedBy: ctx.userId,
      role: 'tenant',
      status: 'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    })
    .returning({ id: importLogs.id });

  const importLog = importLogRows[0];
  if (!importLog) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = importLog.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  // Every payment needs a contract: the tenant's latest active one (AC8: org scoped).
  const contractRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantRecord.id), eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active')))
    .orderBy(desc(contracts.createdAt))
    .limit(1);
  const contractId = contractRows[0]?.id;

  const now = new Date();
  const upserts: (typeof payments.$inferInsert)[] = [];
  const inserts: (typeof payments.$inferInsert)[] = [];

  for (const row of rows) {
    // Security: only allow own email
    if (row.tenant_email && row.tenant_email !== tenantEmail) {
      skipped++;
      continue;
    }
    if (!contractId) {
      skipped++;
      continue;
    }

    (row.external_payment_id ? upserts : inserts).push({
      id:                crypto.randomUUID(),
      orgId:             ctx.orgId,
      contractId,
      tenantId:          tenantRecord.id,
      amount:            String(row.amount),
      currency:          row.currency ?? 'PEN',
      paidAt:            row.payment_date,
      status:            'under_review',
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
          currency:  sql`excluded.currency`,
          paidAt:    sql`excluded.paid_at`,
          method:    sql`excluded.method`,
          reference: sql`excluded.reference`,
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

  // Update import log — Drizzle (AC1)
  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await db
    .update(importLogs)
    .set({
      status: finalStatus,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      rowsFailed: failed,
      completedAt: new Date(),
    })
    .where(eq(importLogs.id, import_id));

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
