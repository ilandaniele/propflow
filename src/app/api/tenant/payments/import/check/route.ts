/**
 * POST /api/tenant/payments/import/check
 * Parses CSV and returns a validation preview.
 * Tenant can only import rows matching their own email.
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
  const { rows, errors, warnings } = parsePaymentsCsv(csvText);

  // Get tenant email from session profile
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', ctx.userId)
    .single();

  const tenantEmail = profile?.email ?? '';

  // Security: tenant can only import rows for their own email
  const rowErrors = [...errors];
  const validRows = rows.filter(row => {
    if (row.tenant_email && row.tenant_email !== tenantEmail) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'tenant_email',
        message: `No puede importar pagos para el email "${row.tenant_email}".`,
      });
      return false;
    }
    return true;
  });

  // Check for duplicate external_payment_id in DB
  const externalIds = validRows.map(r => r.external_payment_id).filter(Boolean) as string[];
  let duplicates: string[] = [];
  if (externalIds.length > 0) {
    const { data: existing } = await admin
      .from('payments')
      .select('external_payment_id')
      .eq('org_id', ctx.orgId)
      .in('external_payment_id', externalIds);
    duplicates = (existing ?? []).map((r: { external_payment_id: string }) => r.external_payment_id).filter(Boolean);
  }

  const rowsWithStatus = validRows.map(row => ({
    ...row,
    is_duplicate: row.external_payment_id ? duplicates.includes(row.external_payment_id) : false,
  }));

  const rows_valid   = rowsWithStatus.length;
  const rows_invalid = rows.length - validRows.length + rowErrors.filter(e => e.rowNumber > 0).length;
  const rows_warning = warnings.length;

  return NextResponse.json({
    rows_valid,
    rows_invalid,
    rows_warning,
    preview_rows: rowsWithStatus.slice(0, 10),
    errors: rowErrors,
    warnings,
  });
}
