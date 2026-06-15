/**
 * POST /api/tenant/payments/import
 * Upserts validated payment rows for the authenticated tenant.
 * Tenant-imported payments are set to status='under_review'.
 *
 * Note: payments.contract_id is NOT NULL. We resolve the tenant's most-recent
 * active contract. Rows where no active contract exists are skipped.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, contracts, payments, importLogs, profiles } from '@/lib/db/schema';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

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

  // Get profile email for security check + tenant record — org-scoped
  const profileRow = await db.select({ email: profiles.email })
    .from(profiles)
    .where(eq(profiles.userId, ctx.userId))
    .then(r => r[0] ?? null);

  const tenantEmail = (profileRow?.email ?? '').trim().toLowerCase();

  const tenantRecord = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  // Resolve tenant's most-recent active contract
  const contractRow = await db.select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.tenantId, tenantRecord.id), eq(contracts.status, 'active')))
    .orderBy(desc(contracts.startDate))
    .limit(1)
    .then(r => r[0] ?? null);

  // Create import log
  let importLogId: string | null = null;
  try {
    const logRows = await db.insert(importLogs).values({
      orgId:        ctx.orgId,
      importType:   'payment',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'tenant',
      status:       'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    }).returning({ id: importLogs.id });
    importLogId = logRows[0]?.id ?? null;
  } catch (err) {
    console.error('[api/tenant/payments/import POST] log error', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  if (!importLogId) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    // Security: only allow own email
    if (row.tenant_email && row.tenant_email !== tenantEmail) {
      skipped++;
      continue;
    }

    // Skip if no active contract
    if (!contractRow) {
      skipped++;
      continue;
    }

    try {
      const payload = {
        orgId:             ctx.orgId,
        contractId:        contractRow.id,
        tenantId:          tenantRecord.id,
        amount:            String(row.amount),
        currency:          row.currency,
        paidAt:            row.payment_date,
        status:            'under_review' as const,  // tenant imports always go to review
        method:            row.payment_method,
        reference:         row.reference ?? null,
        movementType:      'payment' as const,
        externalPaymentId: row.external_payment_id ?? null,
        importSource:      'csv_import' as const,
        importId:          importLogId,
      };

      if (row.external_payment_id) {
        await db.insert(payments).values(payload)
          .onConflictDoUpdate({
            target: [payments.orgId, payments.externalPaymentId],
            set: {
              amount:    payload.amount,
              method:    payload.method,
              reference: payload.reference,
              updatedAt: new Date(),
            },
          });
        updated++;
      } else {
        await db.insert(payments).values(payload);
        created++;
      }
    } catch {
      failed++;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await db.update(importLogs).set({
    status:      finalStatus,
    rowsCreated: created,
    rowsUpdated: updated,
    rowsSkipped: skipped,
    rowsFailed:  failed,
    completedAt: new Date(),
  }).where(eq(importLogs.id, importLogId));

  return NextResponse.json({ created, updated, skipped, failed, import_id: importLogId });
}
