/**
 * POST /api/admin/payments/import/check
 * Parses CSV and returns validation preview (admin — can set any tenant/status).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, payments } from '@/lib/db/schema';
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
  const { rows, errors, warnings } = parsePaymentsCsv(csvText);

  // Check for duplicate external_payment_id — org-scoped
  const externalIds = rows.map(r => r.external_payment_id).filter(Boolean) as string[];
  let duplicates: string[] = [];
  if (externalIds.length > 0) {
    const existing = await db.select({ externalPaymentId: payments.externalPaymentId })
      .from(payments)
      .where(and(eq(payments.orgId, ctx.orgId), inArray(payments.externalPaymentId, externalIds)));
    duplicates = existing.map(r => r.externalPaymentId).filter((v): v is string => !!v);
  }

  // Validate tenant emails exist in org
  const tenantEmails = [...new Set(rows.map(r => r.tenant_email).filter(Boolean))] as string[];
  const tenantEmailMap: Record<string, string> = {};
  if (tenantEmails.length > 0) {
    const tenantRows = await db.select({ id: tenants.id, email: tenants.email })
      .from(tenants)
      .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email, tenantEmails)));
    tenantRows.forEach(t => { if (t.email) tenantEmailMap[t.email] = t.id; });
  }

  const rowsWithStatus = rows.map(row => {
    const unknownTenant = row.tenant_email && !tenantEmailMap[row.tenant_email];
    return {
      ...row,
      is_duplicate: row.external_payment_id ? duplicates.includes(row.external_payment_id) : false,
      unknown_tenant: !!unknownTenant,
      resolved_tenant_id: row.tenant_email ? (tenantEmailMap[row.tenant_email] ?? null) : null,
    };
  });

  const rows_valid   = rowsWithStatus.filter(r => !r.unknown_tenant).length;
  const rows_invalid = errors.filter(e => e.rowNumber > 0).length;
  const rows_warning = warnings.length;

  return NextResponse.json({
    rows_valid,
    rows_invalid,
    rows_warning,
    preview_rows: rowsWithStatus.slice(0, 10),
    errors,
    warnings,
  });
}
