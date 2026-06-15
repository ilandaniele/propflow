/**
 * POST /api/admin/payments/import
 * Upserts validated payment rows (admin — can set any tenant/status).
 *
 * Note: payments.contract_id is NOT NULL. The CSV does not carry a contract_id,
 * so we resolve the tenant's most-recent active contract. Rows where no active
 * contract is found are skipped with a warning.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, contracts, payments, importLogs } from '@/lib/db/schema';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

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

  // Build tenant email → id map for this org
  const tenantEmails = [...new Set(rows.map(r => r.tenant_email).filter(Boolean))] as string[];
  const tenantEmailMap: Record<string, string> = {};
  if (tenantEmails.length > 0) {
    const tenantRows = await db.select({ id: tenants.id, email: tenants.email })
      .from(tenants)
      .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email, tenantEmails)));
    tenantRows.forEach(t => { if (t.email) tenantEmailMap[t.email] = t.id; });
  }

  // Create import log
  let importLogId: string | null = null;
  try {
    const logRows = await db.insert(importLogs).values({
      orgId:        ctx.orgId,
      importType:   'payment',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'admin',
      status:       'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    }).returning({ id: importLogs.id });
    importLogId = logRows[0]?.id ?? null;
  } catch (err) {
    console.error('[api/admin/payments/import POST] log error', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  if (!importLogId) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const tenant_id = row.tenant_id ?? (row.tenant_email ? tenantEmailMap[row.tenant_email] : undefined);
    if (!tenant_id) { skipped++; continue; }

    try {
      // Resolve tenant's most-recent active contract (required for payments.contract_id NOT NULL)
      const contractRow = await db.select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.tenantId, tenant_id), eq(contracts.status, 'active')))
        .orderBy(desc(contracts.startDate))
        .limit(1)
        .then(r => r[0] ?? null);

      if (!contractRow) { skipped++; continue; }

      const payload = {
        orgId:              ctx.orgId,
        contractId:         contractRow.id,
        tenantId:           tenant_id,
        amount:             String(row.amount),
        currency:           row.currency,
        paidAt:             row.payment_date,
        status:             row.status,
        method:             row.payment_method,
        reference:          row.reference ?? null,
        movementType:       'payment' as const,
        externalPaymentId:  row.external_payment_id ?? null,
        importSource:       'csv_import' as const,
        importId:           importLogId,
      };

      if (row.external_payment_id) {
        // Upsert by org_id + external_payment_id — use insert + conflict update pattern
        await db.insert(payments).values(payload)
          .onConflictDoUpdate({
            target: [payments.orgId, payments.externalPaymentId],
            set: {
              amount:      payload.amount,
              status:      payload.status,
              method:      payload.method,
              reference:   payload.reference,
              updatedAt:   new Date(),
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
