/**
 * GET   /api/admin/tenants/[tenantId]  — fetch single tenant detail
 * PATCH /api/admin/tenants/[tenantId]  — update tenant + sync to Airtable
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
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

  const rows = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const tenant = rows[0];
  if (!tenant) {
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

  // Verify tenant belongs to admin's org
  const existing = await db
    .select({
      id:                   tenants.id,
      fullName:             tenants.fullName,
      email:                tenants.email,
      phone:                tenants.phone,
      documentNumber:       tenants.documentNumber,
      dateOfBirth:          tenants.dateOfBirth,
      emergencyContactName: tenants.emergencyContactName,
      emergencyContactPhone: tenants.emergencyContactPhone,
      airtableExternalId:   tenants.airtableExternalId,
      syncStatus:           tenants.syncStatus,
    })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  const prev = existing[0];

  // Build full_name if name fields change
  const newFirst  = data.first_name ?? prev.fullName?.split(' ')[0] ?? '';
  const newLast   = data.last_name  ?? prev.fullName?.split(' ').slice(1).join(' ') ?? '';
  const fullName  = (data.first_name || data.last_name)
    ? `${newFirst} ${newLast}`.trim()
    : undefined;

  const setValues: Partial<typeof tenants.$inferInsert> = {};
  if (fullName)               setValues.fullName            = fullName;
  if (data.email)             setValues.email               = data.email;
  if (data.phone)             setValues.phone               = data.phone;
  if (data.dni !== undefined) setValues.documentNumber      = data.dni;
  if (data.birth_date !== undefined)              setValues.dateOfBirth            = data.birth_date;
  if (data.emergency_contact_name !== undefined)  setValues.emergencyContactName   = data.emergency_contact_name;
  if (data.emergency_contact_phone !== undefined) setValues.emergencyContactPhone  = data.emergency_contact_phone;
  if (data.notes !== undefined)                   setValues.notes                  = data.notes;
  if (data.responsable_id !== undefined)          setValues.responsableId          = data.responsable_id;
  if (data.preferred_language)                    setValues.preferredLanguage      = data.preferred_language;

  const [updatedTenant] = await db
    .update(tenants)
    .set({ ...setValues, updatedAt: new Date() })
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .returning();

  if (!updatedTenant) {
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update tenant.' } }, { status: 500 });
  }

  // Attempt Airtable sync (soft failure)
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;
  let syncStatus: 'synced' | 'failed' | 'skipped' = 'skipped';
  let airtableSynced = false;

  if (tableName) {
    try {
      const result = await upsertAirtableResidente(
        {
          first_name:              newFirst,
          last_name:               newLast,
          email:                   (data.email ?? prev.email) ?? '',
          phone:                   (data.phone ?? prev.phone) ?? '',
          dni:                     data.dni !== undefined ? data.dni : prev.documentNumber,
          birth_date:              data.birth_date !== undefined ? data.birth_date : prev.dateOfBirth,
          emergency_contact_name:  data.emergency_contact_name !== undefined
            ? data.emergency_contact_name
            : prev.emergencyContactName,
          emergency_contact_phone: data.emergency_contact_phone !== undefined
            ? data.emergency_contact_phone
            : prev.emergencyContactPhone,
        },
        prev.airtableExternalId ?? null
      );

      await db
        .update(tenants)
        .set({ airtableExternalId: result.airtableRecordId, syncStatus: 'synced', lastSyncedAt: new Date() })
        .where(eq(tenants.id, tenantId));

      syncStatus = 'synced';
      airtableSynced = true;
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[api/admin/tenants PATCH] Airtable sync failed', { errName, tenantId });
      await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, tenantId));
      syncStatus = 'failed';
    }
  }

  return NextResponse.json({ tenant: updatedTenant, syncStatus, airtableSynced });
}
