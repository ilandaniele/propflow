/**
 * POST /api/tenant/register
 *
 * Tenant self-registration endpoint — called from /onboarding?type=tenant after
 * a new user authenticates via Google OAuth.
 *
 * Steps:
 * 1. Verify authenticated user from Supabase session (never trust client-supplied userId).
 * 2. Validate request body against tenantRegistrationSchema (Zod).
 * 3. Check for duplicate tenant (same org + normalized email).
 * 4. Insert tenant row with sync_status='pending'.
 * 5. Update profiles row: terms_accepted_at, privacy_accepted_at.
 * 6. Attempt Airtable Residentes record creation (soft failure — local record is kept).
 * 7. Return { tenant, syncStatus }.
 *
 * Security:
 * - User identity derived from server-side getUser() — NEVER from request body.
 * - AIRTABLE_PAT is server-only; never included in any response.
 * - No stack traces in error responses.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';
import { log } from '@/lib/log';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: verify session
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 }
    );
  }

  // Step 2: validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' } },
      { status: 400 }
    );
  }

  const parsed = tenantRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Resolve org_id from profile (admin client — profile may not exist yet if this is first run)
  const admin = createAdminClient();

  // Look up the profile to get org_id (may not exist yet — new user)
  const { data: profileRow } = await admin
    .from('profiles')
    .select('id, org_id')
    .eq('id', user.id)
    .single();

  // If no profile row yet, we cannot determine org_id. The auto-link flow should have
  // created a profile before reaching this endpoint. Return a clear error.
  if (!profileRow?.org_id) {
    log.warn('[tenant/register] no profile/org_id for user', { userId: user.id });
    return NextResponse.json(
      { error: { code: 'NO_ORG', message: 'No organization found. Complete onboarding first.' } },
      { status: 422 }
    );
  }

  const orgId = profileRow.org_id as string;

  // Step 3: check for duplicate tenant in this org
  const { data: existingTenant } = await admin
    .from('tenants')
    .select('id')
    .eq('org_id', orgId)
    .eq('email', data.email)
    .maybeSingle();

  if (existingTenant) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists in your organization.' } },
      { status: 409 }
    );
  }

  // Step 4: insert tenant row
  const fullName = `${data.first_name} ${data.last_name}`.trim();

  const { data: tenant, error: insertError } = await admin
    .from('tenants')
    .insert({
      org_id:                   orgId,
      profile_id:               user.id,
      first_name:               data.first_name,
      last_name:                data.last_name,
      full_name:                fullName,
      email:                    data.email,
      phone:                    data.phone,
      dni:                      data.dni,
      birth_date:               data.birth_date,
      emergency_contact_name:   data.emergency_contact_name ?? null,
      emergency_contact_phone:  data.emergency_contact_phone ?? null,
      sync_status:              'pending',
    })
    .select('id, email, full_name, sync_status')
    .single();

  if (insertError || !tenant) {
    log.error('[tenant/register] insert failed', { code: insertError?.code });
    return NextResponse.json(
      { error: { code: 'INSERT_FAILED', message: 'Failed to create tenant record.' } },
      { status: 500 }
    );
  }

  // Step 5: update profile terms acceptance
  const now = new Date().toISOString();
  await admin
    .from('profiles')
    .update({
      terms_accepted_at:   now,
      terms_version:       '1.0',
      privacy_accepted_at: now,
      privacy_version:     '1.0',
    })
    .eq('id', user.id);

  // Step 6: attempt Airtable sync (soft failure)
  const pat      = process.env['AIRTABLE_PAT'];
  const baseId   = process.env['AIRTABLE_BASE_ID'];
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;

  let syncStatus: 'synced' | 'failed' | 'skipped' = 'skipped';
  let syncError: string | null = null;

  if (pat && baseId && tableName) {
    try {
      const airtableRes = await fetch(
        `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(tableName)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pat}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              'Nombre(s)':           data.first_name,
              'Apellidos':           data.last_name,
              'Correo electrónico':  data.email,
              'Número celular':      data.phone,
              'N° DNI':             data.dni,
              'Fecha de nacimiento': data.birth_date,
            },
          }),
          cache: 'no-store',
        }
      );

      if (airtableRes.ok) {
        const airtableData = await airtableRes.json() as { id?: string };
        const recordId = airtableData?.id;
        if (recordId) {
          await admin
            .from('tenants')
            .update({
              airtable_external_id: recordId,
              sync_status:          'synced',
              last_synced_at:       now,
            })
            .eq('id', tenant.id);
        }
        syncStatus = 'synced';
      } else {
        const status = airtableRes.status;
        log.warn('[tenant/register] Airtable sync failed', { status, tenantId: tenant.id });
        await admin
          .from('tenants')
          .update({ sync_status: 'failed' })
          .eq('id', tenant.id);
        syncStatus = 'failed';
        syncError = `Airtable returned HTTP ${status}`;
      }
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      log.error('[tenant/register] Airtable error', { errName, tenantId: tenant.id });
      await admin
        .from('tenants')
        .update({ sync_status: 'failed' })
        .eq('id', tenant.id);
      syncStatus = 'failed';
      syncError = errName;
    }
  }

  // Step 7: respond — always 200 even if Airtable failed (local record is valid)
  return NextResponse.json({
    tenant: {
      id:        tenant.id,
      email:     tenant.email,
      full_name: tenant.full_name,
    },
    syncStatus,
    ...(syncError ? { syncError } : {}),
  });
}
