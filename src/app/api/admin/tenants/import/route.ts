/**
 * POST /api/admin/tenants/import
 * Upserts validated tenant rows. New tenants get portal_access='not_invited'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, tenants } from '@/lib/db/schema';
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
  const { rows, errors } = parseTenantsCsv(csvText);
  const validRows = rows.filter(r => r.action !== 'invalid');

  // Resolve update vs create — Drizzle (AC1, AC8: org scoped)
  const emails      = validRows.map(r => r.email).filter(Boolean);
  const externalIds = validRows.map(r => r.external_tenant_id).filter(Boolean) as string[];

  const [emailRows, extRows] = await Promise.all([
    emails.length > 0
      ? db.select({ id: tenants.id, email: tenants.email })
          .from(tenants).where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email!, emails)))
      : Promise.resolve([] as { id: string; email: string | null }[]),
    externalIds.length > 0
      ? db.select({ id: tenants.id, externalTenantId: tenants.externalTenantId })
          .from(tenants).where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.externalTenantId!, externalIds)))
      : Promise.resolve([] as { id: string; externalTenantId: string | null }[]),
  ]);

  const emailMap: Record<string, { id: string }> = {};
  emailRows.forEach(t => { if (t.email) emailMap[t.email] = { id: t.id }; });
  const extIdMap: Record<string, { id: string }> = {};
  extRows.forEach(t => { if (t.externalTenantId) extIdMap[t.externalTenantId] = { id: t.id }; });

  // Import log — Drizzle (AC1)
  const logRows = await db
    .insert(importLogs)
    .values({
      orgId:        ctx.orgId,
      importType:   'tenant',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'admin',
      status:       'pending',
      rowsReceived: validRows.length,
      errorDetails: errors,
    })
    .returning({ id: importLogs.id });

  const import_id = logRows[0]?.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of validRows) {
    try {
      const byExtId = row.external_tenant_id ? extIdMap[row.external_tenant_id] : undefined;
      const byEmail = row.email ? emailMap[row.email] : undefined;

      // Detect collision: both identifiers present but resolve to different tenants
      if (byExtId && byEmail && byExtId.id !== byEmail.id) {
        console.warn('[api/admin/tenants/import] id collision — skipping row', { email: row.email });
        skipped++;
        continue;
      }

      const existing = byExtId ?? byEmail;

      const tenantPayload: Partial<typeof tenants.$inferInsert> = {
        orgId:                 ctx.orgId,
        fullName:              `${row.first_name} ${row.last_name}`,
        email:                 row.email,
        phone:                 row.phone ?? null,
        documentNumber:        row.document_number ?? null,
        dateOfBirth:           row.date_of_birth ?? null,
        emergencyContactName:  row.emergency_contact_name ?? null,
        emergencyContactPhone: row.emergency_contact_phone ?? null,
        moveInDate:            row.move_in_date ?? null,
        preferredLanguage:     row.preferred_language ?? 'es',
        externalTenantId:      row.external_tenant_id ?? null,
        syncStatus:            'pending',
        importSource:          'csv_import',
        updatedAt:             new Date(),
      };

      if (existing) {
        await db.update(tenants).set(tenantPayload).where(eq(tenants.id, existing.id));
        updated++;
      } else {
        const newRows = await db
          .insert(tenants)
          .values({ ...tenantPayload, portalAccess: 'not_invited' } as typeof tenants.$inferInsert)
          .returning({ id: tenants.id });

        if (newRows.length === 0) { failed++; continue; }
        created++;
      }
    } catch {
      failed++;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  if (import_id) {
    await db.update(importLogs).set({
      status:             finalStatus,
      rowsCreated:        created,
      rowsUpdated:        updated,
      rowsSkipped:        skipped,
      rowsFailed:         failed,
      completedAt:        new Date(),
    }).where(eq(importLogs.id, import_id));
  }

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
