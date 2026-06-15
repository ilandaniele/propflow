/**
 * GET   /api/admin/tenants/[tenantId]  — fetch single tenant detail
 * PATCH /api/admin/tenants/[tenantId]  — update tenant + sync to Airtable
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
import { upsertAirtableResidente } from '@/lib/airtable/write';

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { tenantId } = await params;

  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from('tenants')
    .select(`
      *,
      units(label, properties(name)),
      responsables(full_name)
    `)
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId)
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  return NextResponse.json({ tenant });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const PatchTenantSchema = z.object({
  first_name:               z.string().min(1).max(100).optional(),
  last_name:                z.string().min(1).max(100).optional(),
  email:                    z.string().email().optional(),
  phone:                    z.string().min(6).max(20).optional(),
  dni:                      z.string().min(5).max(20).optional(),
  birth_date:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  emergency_contact_name:   z.string().max(100).nullable().optional(),
  emergency_contact_phone:  z.string().max(20).nullable().optional(),
  tenant_status:            z.enum(['active', 'inactive', 'pending']).optional(),
  notes:                    z.string().max(5000).nullable().optional(),
  responsable_id:           z.string().uuid().nullable().optional(),
  preferred_language:       z.enum(['es', 'en']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { tenantId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' } }, { status: 400 });
  }

  const parsed = PatchTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const admin = createAdminClient();

  // Verify tenant belongs to admin's org
  const { data: existing, error: fetchErr } = await admin
    .from('tenants')
    .select('id, first_name, last_name, email, phone, dni, birth_date, emergency_contact_name, emergency_contact_phone, airtable_external_id, sync_status')
    .eq('id', tenantId)
    .eq('org_id', ctx.orgId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  // Build update payload — include full_name if name fields change
  const updatePayload: Record<string, unknown> = { ...data };
  const newFirst = data.first_name ?? existing.first_name;
  const newLast  = data.last_name  ?? existing.last_name;
  if (data.first_name || data.last_name) {
    updatePayload['full_name'] = `${newFirst} ${newLast}`.trim();
  }

  const now = new Date().toISOString();

  const { data: updatedTenant, error: updateErr } = await admin
    .from('tenants')
    .update(updatePayload)
    .eq('id', tenantId)
    .select('*')
    .single();

  if (updateErr || !updatedTenant) {
    console.error('[api/admin/tenants PATCH] update failed', updateErr?.code);
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update tenant.' } }, { status: 500 });
  }

  // Attempt Airtable sync (soft failure)
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;
  let syncStatus: 'synced' | 'failed' | 'skipped' = 'skipped';
  let airtableSynced = false;

  if (tableName) {
    try {
      const tenantForAirtable = {
        first_name:              newFirst ?? '',
        last_name:               newLast  ?? '',
        email:                   (data.email ?? existing.email) ?? '',
        phone:                   (data.phone ?? existing.phone) ?? '',
        dni:                     data.dni !== undefined ? data.dni : existing.dni,
        birth_date:              data.birth_date !== undefined ? data.birth_date : existing.birth_date,
        emergency_contact_name:  data.emergency_contact_name !== undefined
          ? data.emergency_contact_name
          : existing.emergency_contact_name,
        emergency_contact_phone: data.emergency_contact_phone !== undefined
          ? data.emergency_contact_phone
          : existing.emergency_contact_phone,
      };

      const result = await upsertAirtableResidente(
        tenantForAirtable,
        existing.airtable_external_id ?? null
      );

      await admin
        .from('tenants')
        .update({
          airtable_external_id: result.airtableRecordId,
          sync_status:          'synced',
          last_synced_at:       now,
        })
        .eq('id', tenantId);

      syncStatus = 'synced';
      airtableSynced = true;
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[api/admin/tenants PATCH] Airtable sync failed', { errName, tenantId });
      await admin.from('tenants').update({ sync_status: 'failed' }).eq('id', tenantId);
      syncStatus = 'failed';
    }
  }

  return NextResponse.json({
    tenant: updatedTenant,
    syncStatus,
    airtableSynced,
  });
}
