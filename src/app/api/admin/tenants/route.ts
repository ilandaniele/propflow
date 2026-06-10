/**
 * GET  /api/admin/tenants  — paginated tenant list for admin
 * POST /api/admin/tenants  — create new tenant (admin-only)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';
import { upsertAirtableResidente } from '@/lib/airtable/write';

// ── GET ───────────────────────────────────────────────────────────────────────

const GetQuerySchema = z.object({
  search:      z.string().max(200).optional(),
  status:      z.string().optional(),
  sync_status: z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = GetQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { search, status, sync_status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const admin = createAdminClient();

  let query = admin
    .from('tenants')
    .select(
      'id, full_name, first_name, last_name, email, phone, dni, tenant_status, sync_status, last_synced_at, airtable_external_id, portal_access, unit_id, created_at, units(label, properties(name))',
      { count: 'exact' }
    )
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (status) {
    query = query.eq('tenant_status', status);
  }
  if (sync_status) {
    query = query.eq('sync_status', sync_status);
  }

  const { data: tenants, count, error } = await query;

  if (error) {
    console.error('[api/admin/tenants GET]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tenants.' } }, { status: 500 });
  }

  return NextResponse.json({ tenants: tenants ?? [], total: count ?? 0, page });
}

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateTenantSchema = tenantRegistrationSchema
  .omit({ terms_accepted: true, privacy_accepted: true })
  .extend({
    tenant_status:   z.enum(['active', 'inactive', 'pending']).optional().default('pending'),
    notes:           z.string().max(5000).optional(),
    responsable_id:  z.string().uuid().optional(),
  });

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' } }, { status: 400 });
  }

  const parsed = CreateTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const admin = createAdminClient();

  // Check for duplicate email in org
  const { data: existing } = await admin
    .from('tenants')
    .select('id')
    .eq('org_id', ctx.orgId)
    .eq('email', data.email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists.' } },
      { status: 409 }
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`.trim();
  const now = new Date().toISOString();

  const insertPayload: Record<string, unknown> = {
    org_id:                   ctx.orgId,
    first_name:               data.first_name,
    last_name:                data.last_name,
    full_name:                fullName,
    email:                    data.email,
    phone:                    data.phone,
    dni:                      data.dni,
    birth_date:               data.birth_date,
    emergency_contact_name:   data.emergency_contact_name ?? null,
    emergency_contact_phone:  data.emergency_contact_phone ?? null,
    tenant_status:            data.tenant_status,
    notes:                    data.notes ?? null,
    responsable_id:           data.responsable_id ?? null,
    sync_status:              'pending',
  };

  const { data: tenant, error: insertError } = await admin
    .from('tenants')
    .insert(insertPayload)
    .select('id, email, full_name, sync_status, airtable_external_id')
    .single();

  if (insertError || !tenant) {
    console.error('[api/admin/tenants POST] insert failed', insertError?.code);
    return NextResponse.json({ error: { code: 'INSERT_FAILED', message: 'Failed to create tenant.' } }, { status: 500 });
  }

  // Attempt Airtable sync (soft failure — local record is kept regardless)
  let syncStatus: 'synced' | 'failed' | 'skipped' = 'skipped';
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;

  if (tableName) {
    try {
      const result = await upsertAirtableResidente({
        first_name:              data.first_name,
        last_name:               data.last_name,
        email:                   data.email,
        phone:                   data.phone,
        dni:                     data.dni,
        birth_date:              data.birth_date,
        emergency_contact_name:  data.emergency_contact_name ?? null,
        emergency_contact_phone: data.emergency_contact_phone ?? null,
      });

      await admin
        .from('tenants')
        .update({
          airtable_external_id: result.airtableRecordId,
          sync_status:          'synced',
          last_synced_at:       now,
        })
        .eq('id', tenant.id);

      syncStatus = 'synced';
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[api/admin/tenants POST] Airtable sync failed', { errName, tenantId: tenant.id });
      await admin.from('tenants').update({ sync_status: 'failed' }).eq('id', tenant.id);
      syncStatus = 'failed';
    }
  }

  return NextResponse.json({ tenant, syncStatus }, { status: 201 });
}
