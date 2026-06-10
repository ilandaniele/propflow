/**
 * POST /api/tenant/payments/import
 * Upserts validated payment rows for the authenticated tenant.
 * Tenant-imported payments are set to status='under_review'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
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

  const admin = createAdminClient();

  // Get profile for email security check + tenant record
  const { data: profile } = await admin.from('profiles').select('email').eq('id', ctx.userId).single();
  const tenantEmail = profile?.email ?? '';

  const { data: tenantRecord } = await admin
    .from('tenants').select('id').eq('profile_id', ctx.userId).eq('org_id', ctx.orgId).single();

  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  // Create import log
  const { data: importLog, error: logError } = await admin
    .from('import_logs')
    .insert({
      org_id: ctx.orgId,
      import_type: 'payment',
      file_name: file.name,
      imported_by: ctx.userId,
      role: 'tenant',
      status: 'pending',
      rows_received: rows.length,
      error_details: errors,
    })
    .select('id')
    .single();

  if (logError || !importLog) {
    console.error('[api/tenant/payments/import POST] log error', logError?.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = importLog.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    // Security: only allow own email
    if (row.tenant_email && row.tenant_email !== tenantEmail) {
      skipped++;
      continue;
    }

    try {
      const payload = {
        org_id: ctx.orgId,
        tenant_id: tenantRecord.id,
        amount: row.amount,
        currency: row.currency,
        paid_at: row.payment_date,
        due_date: row.due_date ?? null,
        status: 'under_review' as const, // tenant imports always go to review
        method: row.payment_method,
        reference: row.reference ?? null,
        period_month: row.billing_period ?? null,
        movement_type: 'payment' as const,
        notes: row.description ?? null,
        external_payment_id: row.external_payment_id ?? null,
        import_source: 'csv_import' as const,
        import_id,
      };

      if (row.external_payment_id) {
        // Upsert by org_id + external_payment_id
        const { error: upsertErr } = await admin
          .from('payments')
          .upsert(payload, { onConflict: 'org_id,external_payment_id', ignoreDuplicates: false });

        if (upsertErr) { failed++; continue; }
        updated++;
      } else {
        const { error: insertErr } = await admin.from('payments').insert(payload);
        if (insertErr) { failed++; continue; }
        created++;
      }
    } catch {
      failed++;
    }
  }

  // Update import log
  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await admin.from('import_logs').update({
    status: finalStatus,
    rows_created: created,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_failed: failed,
    completed_at: new Date().toISOString(),
  }).eq('id', import_id);

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
