/**
 * POST /api/admin/tenants/import
 * Upserts validated tenant rows. New tenants get portal_access='not_invited'.
 * Also attempts Airtable Residentes upsert for each row.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
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

  const admin = createAdminClient();

  // Resolve update vs create
  const emails      = validRows.map(r => r.email).filter(Boolean);
  const externalIds = validRows.map(r => r.external_tenant_id).filter(Boolean) as string[];

  const [emailRes, extRes] = await Promise.all([
    emails.length > 0
      ? admin.from('tenants').select('id, email, airtable_external_id').eq('org_id', ctx.orgId).in('email', emails)
      : Promise.resolve({ data: [] }),
    externalIds.length > 0
      ? admin.from('tenants').select('id, external_tenant_id, airtable_external_id').eq('org_id', ctx.orgId).in('external_tenant_id', externalIds)
      : Promise.resolve({ data: [] }),
  ]);

  const emailMap: Record<string, { id: string; airtable_external_id: string | null }> = {};
  (emailRes.data ?? []).forEach((t: { id: string; email: string; airtable_external_id: string | null }) => {
    emailMap[t.email] = { id: t.id, airtable_external_id: t.airtable_external_id };
  });
  const extIdMap: Record<string, { id: string; airtable_external_id: string | null }> = {};
  (extRes.data ?? []).forEach((t: { id: string; external_tenant_id: string; airtable_external_id: string | null }) => {
    if (t.external_tenant_id) extIdMap[t.external_tenant_id] = { id: t.id, airtable_external_id: t.airtable_external_id };
  });

  // Import log
  const { data: importLog } = await admin
    .from('import_logs')
    .insert({
      org_id: ctx.orgId,
      import_type: 'tenant',
      file_name: file.name,
      imported_by: ctx.userId,
      role: 'admin',
      status: 'pending',
      rows_received: validRows.length,
      error_details: errors,
    })
    .select('id')
    .single();

  const import_id = importLog?.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;
  const airtableResults: unknown[] = [];

  for (const row of validRows) {
    try {
      const existing = row.external_tenant_id
        ? extIdMap[row.external_tenant_id]
        : emailMap[row.email];

      const tenantPayload = {
        org_id: ctx.orgId,
        first_name: row.first_name,
        last_name: row.last_name,
        full_name: `${row.first_name} ${row.last_name}`,
        email: row.email,
        phone: row.phone ?? null,
        document_number: row.document_number ?? null,
        date_of_birth: row.date_of_birth ?? null,
        emergency_contact_name: row.emergency_contact_name ?? null,
        emergency_contact_phone: row.emergency_contact_phone ?? null,
        tenant_status: row.status,
        move_in_date: row.move_in_date ?? null,
        preferred_language: row.preferred_language,
        external_tenant_id: row.external_tenant_id ?? null,
        sync_status: 'pending' as const,
        import_source: 'csv_import',
      };

      if (existing) {
        const { error } = await admin.from('tenants').update(tenantPayload).eq('id', existing.id);
        if (error) { failed++; continue; }
        updated++;

        // Airtable write-back
        try {
          const result = await upsertAirtableResidente({
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            phone: row.phone ?? '',
            emergency_contact_name: row.emergency_contact_name,
            emergency_contact_phone: row.emergency_contact_phone,
          }, existing.airtable_external_id);
          await admin.from('tenants').update({
            airtable_external_id: result.airtableRecordId,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          }).eq('id', existing.id);
          airtableResults.push({ id: existing.id, status: 'ok' });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          airtableResults.push({ id: existing.id, status: 'error', message: msg });
          await admin.from('tenants').update({ sync_status: 'failed' }).eq('id', existing.id);
        }
      } else {
        const { data: newTenant, error } = await admin
          .from('tenants')
          .insert({ ...tenantPayload, portal_access: 'not_invited' })
          .select('id')
          .single();

        if (error || !newTenant) { failed++; continue; }
        created++;

        // Airtable write-back
        try {
          const result = await upsertAirtableResidente({
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            phone: row.phone ?? '',
            emergency_contact_name: row.emergency_contact_name,
            emergency_contact_phone: row.emergency_contact_phone,
          });
          await admin.from('tenants').update({
            airtable_external_id: result.airtableRecordId,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          }).eq('id', newTenant.id);
          airtableResults.push({ id: newTenant.id, status: 'ok' });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          airtableResults.push({ id: newTenant.id, status: 'error', message: msg });
          await admin.from('tenants').update({ sync_status: 'failed' }).eq('id', newTenant.id);
        }
      }
    } catch {
      failed++;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  if (import_id) {
    await admin.from('import_logs').update({
      status: finalStatus,
      rows_created: created,
      rows_updated: updated,
      rows_skipped: skipped,
      rows_failed: failed,
      airtable_sync_result: airtableResults,
      completed_at: new Date().toISOString(),
    }).eq('id', import_id);
  }

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
