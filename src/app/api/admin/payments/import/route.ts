/**
 * POST /api/admin/payments/import
 * Upserts validated payment rows (admin — can set any tenant/status).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
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

  const admin = createAdminClient();

  // Build tenant email → id map for this org
  const tenantEmails = [...new Set(rows.map(r => r.tenant_email).filter(Boolean))] as string[];
  const tenantEmailMap: Record<string, string> = {};
  if (tenantEmails.length > 0) {
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, email')
      .eq('org_id', ctx.orgId)
      .in('email', tenantEmails);
    (tenants ?? []).forEach((t: { id: string; email: string }) => { tenantEmailMap[t.email] = t.id; });
  }

  const { data: importLog, error: logError } = await admin
    .from('import_logs')
    .insert({
      org_id: ctx.orgId,
      import_type: 'payment',
      file_name: file.name,
      imported_by: ctx.userId,
      role: 'admin',
      status: 'pending',
      rows_received: rows.length,
      error_details: errors,
    })
    .select('id')
    .single();

  if (logError || !importLog) {
    console.error('[api/admin/payments/import POST] log error', logError?.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = importLog.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const tenant_id = row.tenant_id ?? (row.tenant_email ? tenantEmailMap[row.tenant_email] : undefined);
    if (!tenant_id) { skipped++; continue; }

    try {
      const payload = {
        org_id: ctx.orgId,
        tenant_id,
        amount: row.amount,
        currency: row.currency,
        paid_at: row.payment_date,
        due_date: row.due_date ?? null,
        status: row.status,
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
