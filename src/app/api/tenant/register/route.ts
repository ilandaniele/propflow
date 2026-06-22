/**
 * POST /api/tenant/register
 *
 * Tenant self-registration endpoint — called from /onboarding?type=tenant after
 * a new user authenticates via OAuth.
 *
 * Security:
 * - User identity derived from server-side NextAuth session — NEVER from request body.
 * - AIRTABLE_PAT is server-only; never included in any response.
 * - No stack traces in error responses.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { profiles, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';
import { log } from '@/lib/log';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: verify session (NextAuth — never trust client-supplied userId)
  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
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

  // Resolve org_id from profile (may not exist yet for new users) — Drizzle (AC1)
  const profileRows = await db
    .select({ id: profiles.id, orgId: profiles.orgId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const profileRow = profileRows[0];

  if (!profileRow?.orgId) {
    log.warn('[tenant/register] no profile/org_id for user', { userId: user.id });
    return NextResponse.json(
      { error: { code: 'NO_ORG', message: 'No organization found. Complete onboarding first.' } },
      { status: 422 }
    );
  }

  const orgId = profileRow.orgId;

  // Step 3: check for duplicate tenant in this org — Drizzle (AC1, AC8: org scoped)
  const existingRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.orgId, orgId), eq(tenants.email!, data.email)))
    .limit(1);

  if (existingRows.length > 0) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists in your organization.' } },
      { status: 409 }
    );
  }

  // Step 4: insert tenant row — Drizzle (AC1)
  const fullName = `${data.first_name} ${data.last_name}`.trim();

  let insertedTenant: { id: string; email: string | null; fullName: string | null; syncStatus: string };
  try {
    const rows = await db
      .insert(tenants)
      .values({
        orgId,
        profileId:              user.id,
        fullName,
        email:                  data.email,
        phone:                  data.phone,
        documentNumber:         data.dni ?? null,
        dateOfBirth:            data.birth_date ?? null,
        emergencyContactName:   data.emergency_contact_name ?? null,
        emergencyContactPhone:  data.emergency_contact_phone ?? null,
        syncStatus:             'pending',
      })
      .returning({
        id:         tenants.id,
        email:      tenants.email,
        fullName:   tenants.fullName,
        syncStatus: tenants.syncStatus,
      });

    if (rows.length === 0) throw new Error('No row returned');
    insertedTenant = rows[0];
  } catch (err) {
    log.error('[tenant/register] insert failed', { error: err instanceof Error ? err.message : 'unknown' });
    return NextResponse.json(
      { error: { code: 'INSERT_FAILED', message: 'Failed to create tenant record.' } },
      { status: 500 }
    );
  }

  // Step 5: update profile terms acceptance — Drizzle (AC1)
  const now = new Date();
  await db
    .update(profiles)
    .set({
      termsAcceptedAt:   now,
      termsVersion:      '1.0',
      privacyAcceptedAt: now,
      privacyVersion:    '1.0',
    })
    .where(eq(profiles.userId, user.id));

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
          await db
            .update(tenants)
            .set({
              airtableExternalId: recordId,
              syncStatus:         'synced',
              lastSyncedAt:       new Date(),
            })
            .where(eq(tenants.id, insertedTenant.id));
        }
        syncStatus = 'synced';
      } else {
        const httpStatus = airtableRes.status;
        log.warn('[tenant/register] Airtable sync failed', { status: httpStatus, tenantId: insertedTenant.id });
        await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, insertedTenant.id));
        syncStatus = 'failed';
        syncError = `Airtable returned HTTP ${httpStatus}`;
      }
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      log.error('[tenant/register] Airtable error', { errName, tenantId: insertedTenant.id });
      await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, insertedTenant.id));
      syncStatus = 'failed';
      syncError = errName;
    }
  }

  // Step 7: respond — always 200 even if Airtable failed (local record is valid)
  return NextResponse.json({
    tenant: {
      id:        insertedTenant.id,
      email:     insertedTenant.email,
      full_name: insertedTenant.fullName,
    },
    syncStatus,
    ...(syncError ? { syncError } : {}),
  });
}
