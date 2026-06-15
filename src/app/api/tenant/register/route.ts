/**
 * POST /api/tenant/register
 *
 * Tenant self-registration endpoint — called from /onboarding?type=tenant after
 * a new user authenticates via Google OAuth.
 *
 * Steps:
 * 1. Verify authenticated user from NextAuth session (never trust client-supplied userId).
 * 2. Validate request body against tenantRegistrationSchema (Zod).
 * 3. Check for duplicate tenant (same org + normalized email).
 * 4. Insert tenant row with sync_status='pending'.
 * 5. Update profiles row: terms_accepted_at, privacy_accepted_at.
 * 6. Attempt Airtable Residentes record creation (soft failure — local record is kept).
 * 7. Return { tenant, syncStatus }.
 *
 * Security:
 * - User identity derived from server-side NextAuth auth() — NEVER from request body.
 * - AIRTABLE_PAT is server-only; never included in any response.
 * - No stack traces in error responses.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles, tenants } from '@/lib/db/schema';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';
import { log } from '@/lib/log';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: verify session via NextAuth
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 }
    );
  }
  const userId = session.user.id;

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

  // Look up profile to get org_id (user_id FK for NextAuth-based profiles)
  const profileRow = await db.select({ id: profiles.id, orgId: profiles.orgId })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .then(r => r[0] ?? null);

  if (!profileRow?.orgId) {
    log.warn('[tenant/register] no profile/org_id for user', { userId });
    return NextResponse.json(
      { error: { code: 'NO_ORG', message: 'No organization found. Complete onboarding first.' } },
      { status: 422 }
    );
  }

  const orgId = profileRow.orgId;
  const profileId = profileRow.id;

  // Step 3: check for duplicate tenant in this org
  const existingTenant = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.orgId, orgId), eq(tenants.email, data.email)))
    .then(r => r[0] ?? null);

  if (existingTenant) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists in your organization.' } },
      { status: 409 }
    );
  }

  // Step 4: insert tenant row
  const fullName = `${data.first_name} ${data.last_name}`.trim();

  let tenant: { id: string; email: string | null; fullName: string; syncStatus: string } | null = null;
  try {
    const rows = await db.insert(tenants).values({
      orgId,
      profileId,
      fullName,
      email:                data.email,
      phone:                data.phone,
      documentNumber:       data.dni,
      dateOfBirth:          data.birth_date,
      emergencyContactName:  data.emergency_contact_name ?? null,
      emergencyContactPhone: data.emergency_contact_phone ?? null,
      syncStatus:           'pending',
    }).returning({
      id:         tenants.id,
      email:      tenants.email,
      fullName:   tenants.fullName,
      syncStatus: tenants.syncStatus,
    });
    tenant = rows[0] ?? null;
  } catch (err) {
    log.error('[tenant/register] insert failed', { code: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INSERT_FAILED', message: 'Failed to create tenant record.' } },
      { status: 500 }
    );
  }

  if (!tenant) {
    return NextResponse.json(
      { error: { code: 'INSERT_FAILED', message: 'Failed to create tenant record.' } },
      { status: 500 }
    );
  }

  // Step 5: update profile terms acceptance
  const now = new Date();
  await db.update(profiles).set({
    termsAcceptedAt:   now,
    termsVersion:      '1.0',
    privacyAcceptedAt: now,
    privacyVersion:    '1.0',
  }).where(eq(profiles.id, profileId));

  // Step 6: attempt Airtable sync (soft failure)
  const pat       = process.env['AIRTABLE_PAT'];
  const baseId    = process.env['AIRTABLE_BASE_ID'];
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
          await db.update(tenants).set({
            airtableExternalId: recordId,
            syncStatus:         'synced',
            lastSyncedAt:       now,
          }).where(eq(tenants.id, tenant.id));
        }
        syncStatus = 'synced';
      } else {
        const httpStatus = airtableRes.status;
        log.warn('[tenant/register] Airtable sync failed', { status: httpStatus, tenantId: tenant.id });
        await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, tenant.id));
        syncStatus = 'failed';
        syncError = `Airtable returned HTTP ${httpStatus}`;
      }
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      log.error('[tenant/register] Airtable error', { errName, tenantId: tenant.id });
      await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, tenant.id));
      syncStatus = 'failed';
      syncError = errName;
    }
  }

  // Step 7: respond
  return NextResponse.json({
    tenant: {
      id:        tenant.id,
      email:     tenant.email,
      full_name: tenant.fullName,
    },
    syncStatus,
    ...(syncError ? { syncError } : {}),
  });
}
