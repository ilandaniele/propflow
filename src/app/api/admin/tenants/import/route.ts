/**
 * POST /api/admin/tenants/import
 * Upserts validated tenant rows. New tenants get portal_access='not_invited'.
 * Also attempts Airtable Residentes upsert for each row.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, importLogs } from '@/lib/db/schema';
import { parseTenantsCsv } from '@/lib/csv/parseTenantsCsv';
import { upsertAirtableResidente } from '@/lib/airtable/write';

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

  // Resolve update vs create — org-scoped lookups
  const emails      = validRows.map(r => r.email).filter(Boolean) as string[];
  const externalIds = validRows.map(r => r.external_tenant_id).filter(Boolean) as string[];

  const [emailRes, extRes] = await Promise.all([
    emails.length > 0
      ? db.select({ id: tenants.id, email: tenants.email, airtableExternalId: tenants.airtableExternalId })
          .from(tenants)
          .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email, emails)))
      : Promise.resolve([]),
    externalIds.length > 0
      ? db.select({ id: tenants.id, externalTenantId: tenants.externalTenantId, airtableExternalId: tenants.airtableExternalId })
          .from(tenants)
          .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.externalTenantId, externalIds)))
      : Promise.resolve([]),
  ]);

  const emailMap: Record<string, { id: string; airtable_external_id: string | null }> = {};
  emailRes.forEach(t => {
    if (t.email) emailMap[t.email] = { id: t.id, airtable_external_id: t.airtableExternalId };
  });
  const extIdMap: Record<string, { id: string; airtable_external_id: string | null }> = {};
  extRes.forEach(t => {
    if (t.externalTenantId) extIdMap[t.externalTenantId] = { id: t.id, airtable_external_id: t.airtableExternalId };
  });

  // Import log
  let importLogId: string | null = null;
  try {
    const logRows = await db.insert(importLogs).values({
      orgId:        ctx.orgId,
      importType:   'tenant',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'admin',
      status:       'pending',
      rowsReceived: validRows.length,
      errorDetails: errors,
    }).returning({ id: importLogs.id });
    importLogId = logRows[0]?.id ?? null;
  } catch { /* log creation failure is non-blocking */ }

  let created = 0, updated = 0, skipped = 0, failed = 0;
  const airtableResults: unknown[] = [];

  for (const row of validRows) {
    try {
      const byExtId = row.external_tenant_id ? extIdMap[row.external_tenant_id] : undefined;
      const byEmail = row.email ? emailMap[row.email] : undefined;

      if (byExtId && byEmail && byExtId.id !== byEmail.id) {
        skipped++;
        continue;
      }

      const existing = byExtId ?? byEmail;

      const tenantPayload = {
        orgId:                ctx.orgId,
        fullName:             `${row.first_name} ${row.last_name}`,
        email:                row.email,
        phone:                row.phone ?? null,
        documentNumber:       row.document_number ?? null,
        dateOfBirth:          row.date_of_birth ?? null,
        emergencyContactName:  row.emergency_contact_name ?? null,
        emergencyContactPhone: row.emergency_contact_phone ?? null,
        moveInDate:            row.move_in_date ?? null,
        preferredLanguage:    row.preferred_language ?? 'es',
        externalTenantId:     row.external_tenant_id ?? null,
        syncStatus:           'pending' as const,
        importSource:         'csv_import',
      };

      if (existing) {
        await db.update(tenants)
          .set({ ...tenantPayload, updatedAt: new Date() })
          .where(and(eq(tenants.id, existing.id), eq(tenants.orgId, ctx.orgId)));
        updated++;

        // Airtable write-back
        try {
          const result = await upsertAirtableResidente({
            first_name: row.first_name,
            last_name:  row.last_name,
            email:      row.email,
            phone:      row.phone ?? '',
            emergency_contact_name:  row.emergency_contact_name,
            emergency_contact_phone: row.emergency_contact_phone,
          }, existing.airtable_external_id);
          await db.update(tenants).set({
            airtableExternalId: result.airtableRecordId,
            syncStatus:         'synced',
            lastSyncedAt:       new Date(),
          }).where(and(eq(tenants.id, existing.id), eq(tenants.orgId, ctx.orgId)));
          airtableResults.push({ id: existing.id, status: 'ok' });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          airtableResults.push({ id: existing.id, status: 'error', message: msg });
          await db.update(tenants).set({ syncStatus: 'failed' })
            .where(and(eq(tenants.id, existing.id), eq(tenants.orgId, ctx.orgId)));
        }
      } else {
        const newRows = await db.insert(tenants).values({
          ...tenantPayload,
          portalAccess: 'not_invited',
        }).returning({ id: tenants.id });

        const newTenant = newRows[0] ?? null;
        if (!newTenant) { failed++; continue; }
        created++;

        try {
          const result = await upsertAirtableResidente({
            first_name: row.first_name,
            last_name:  row.last_name,
            email:      row.email,
            phone:      row.phone ?? '',
            emergency_contact_name:  row.emergency_contact_name,
            emergency_contact_phone: row.emergency_contact_phone,
          });
          await db.update(tenants).set({
            airtableExternalId: result.airtableRecordId,
            syncStatus:         'synced',
            lastSyncedAt:       new Date(),
          }).where(and(eq(tenants.id, newTenant.id), eq(tenants.orgId, ctx.orgId)));
          airtableResults.push({ id: newTenant.id, status: 'ok' });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          airtableResults.push({ id: newTenant.id, status: 'error', message: msg });
          await db.update(tenants).set({ syncStatus: 'failed' })
            .where(and(eq(tenants.id, newTenant.id), eq(tenants.orgId, ctx.orgId)));
        }
      }
    } catch {
      failed++;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  if (importLogId) {
    await db.update(importLogs).set({
      status:             finalStatus,
      rowsCreated:        created,
      rowsUpdated:        updated,
      rowsSkipped:        skipped,
      rowsFailed:         failed,
      airtableSyncResult: airtableResults,
      completedAt:        new Date(),
    }).where(eq(importLogs.id, importLogId));
  }

  return NextResponse.json({ created, updated, skipped, failed, import_id: importLogId });
}
