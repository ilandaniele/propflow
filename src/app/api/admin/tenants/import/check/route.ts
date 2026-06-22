/**
 * POST /api/admin/tenants/import/check
 * Parses CSV and returns a validation preview with action per row.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { parseTenantsCsv } from '@/lib/csv/parseTenantsCsv';

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
  const { rows, errors, warnings } = parseTenantsCsv(csvText);

  // Resolve actions: check existing by external_tenant_id or email — Drizzle (AC1, AC8)
  const emails      = rows.map(r => r.email).filter(Boolean);
  const externalIds = rows.map(r => r.external_tenant_id).filter(Boolean) as string[];

  const [emailRows, extRows] = await Promise.all([
    emails.length > 0
      ? db.select({ id: tenants.id, email: tenants.email })
          .from(tenants)
          .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email!, emails)))
      : Promise.resolve([] as { id: string; email: string | null }[]),
    externalIds.length > 0
      ? db.select({ id: tenants.id, externalTenantId: tenants.externalTenantId })
          .from(tenants)
          .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.externalTenantId!, externalIds)))
      : Promise.resolve([] as { id: string; externalTenantId: string | null }[]),
  ]);

  const emailMap: Record<string, string> = {};
  emailRows.forEach(t => { if (t.email) emailMap[t.email] = t.id; });

  const extIdMap: Record<string, string> = {};
  extRows.forEach(t => { if (t.externalTenantId) extIdMap[t.externalTenantId] = t.id; });

  const resolvedRows = rows
    .filter(r => r.action !== 'invalid')
    .map(row => {
      let action: 'create' | 'update' | 'skip' = 'create';
      let existingId: string | null = null;

      if (row.external_tenant_id && extIdMap[row.external_tenant_id]) {
        action = 'update';
        existingId = extIdMap[row.external_tenant_id];
      } else if (emailMap[row.email]) {
        action = 'update';
        existingId = emailMap[row.email];
      }

      return { ...row, action, existing_id: existingId };
    });

  const counts = resolvedRows.reduce(
    (acc, r) => { acc[r.action] = (acc[r.action] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return NextResponse.json({
    rows_total:   rows.length,
    rows_create:  counts['create'] ?? 0,
    rows_update:  counts['update'] ?? 0,
    rows_invalid: errors.filter(e => e.rowNumber > 0).length,
    rows_warning: warnings.length,
    preview_rows: resolvedRows.slice(0, 10),
    errors,
    warnings,
  });
}
