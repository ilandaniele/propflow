/**
 * GET   /api/admin/tenants/[tenantId]  — fetch single tenant detail
 * PATCH /api/admin/tenants/[tenantId]  — update tenant + sync to Airtable
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, units, properties, responsables } from '@/lib/db/schema';
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

  const rows = await db.select({
    id:                    tenants.id,
    orgId:                 tenants.orgId,
    fullName:              tenants.fullName,
    email:                 tenants.email,
    phone:                 tenants.phone,
    documentNumber:        tenants.documentNumber,
    dateOfBirth:           tenants.dateOfBirth,
    emergencyContactName:  tenants.emergencyContactName,
    emergencyContactPhone: tenants.emergencyContactPhone,
    syncStatus:            tenants.syncStatus,
    lastSyncedAt:          tenants.lastSyncedAt,
    airtableExternalId:    tenants.airtableExternalId,
    portalAccess:          tenants.portalAccess,
    notes:                 tenants.notes,
    preferredLanguage:     tenants.preferredLanguage,
    unitId:                tenants.unitId,
    responsableId:         tenants.responsableId,
    createdAt:             tenants.createdAt,
    updatedAt:             tenants.updatedAt,
    unitLabel:             units.label,
    propertyName:          properties.name,
    responsableFullName:   responsables.fullName,
  })
    .from(tenants)
    .leftJoin(units, eq(units.id, tenants.unitId))
    .leftJoin(properties, eq(properties.id, units.propertyId))
    .leftJoin(responsables, eq(responsables.id, tenants.responsableId))
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));

  const tenant = rows[0] ?? null;
  if (!tenant) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  return NextResponse.json({ tenant });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const PatchTenantSchema = z.object({
  full_name:                z.string().min(1).max(200).optional(),
  email:                    z.string().email().optional(),
  phone:                    z.string().min(6).max(20).optional(),
  document_number:          z.string().max(20).nullable().optional(),
  date_of_birth:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
  const existing = await db.select({
    id:                 tenants.id,
    fullName:           tenants.fullName,
    email:              tenants.email,
    phone:              tenants.phone,
    documentNumber:     tenants.documentNumber,
    dateOfBirth:        tenants.dateOfBirth,
    emergencyContactName:  tenants.emergencyContactName,
    emergencyContactPhone: tenants.emergencyContactPhone,
    airtableExternalId: tenants.airtableExternalId,
    syncStatus:         tenants.syncStatus,
  })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, { status: 404 });
  }

  const now = new Date();

  // Build update set
  const updateSet: Record<string, unknown> = { updatedAt: now };
  if (data.full_name !== undefined)               updateSet['fullName']              = data.full_name;
  if (data.email !== undefined)                   updateSet['email']                 = data.email;
  if (data.phone !== undefined)                   updateSet['phone']                 = data.phone;
  if (data.document_number !== undefined)         updateSet['documentNumber']        = data.document_number;
  if (data.date_of_birth !== undefined)           updateSet['dateOfBirth']           = data.date_of_birth;
  if (data.emergency_contact_name !== undefined)  updateSet['emergencyContactName']  = data.emergency_contact_name;
  if (data.emergency_contact_phone !== undefined) updateSet['emergencyContactPhone'] = data.emergency_contact_phone;
  if (data.notes !== undefined)                   updateSet['notes']                 = data.notes;
  if (data.responsable_id !== undefined)          updateSet['responsableId']         = data.responsable_id;
  if (data.preferred_language !== undefined)      updateSet['preferredLanguage']     = data.preferred_language;

  let updatedTenant: Record<string, unknown> | null = null;
  try {
    const rows = await db.update(tenants)
      .set(updateSet as Parameters<typeof db.update>[0] extends { set: (v: infer V) => unknown } ? V : never)
      .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)))
      .returning();
    updatedTenant = (rows[0] as Record<string, unknown>) ?? null;
  } catch (err) {
    console.error('[api/admin/tenants PATCH] update failed', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update tenant.' } }, { status: 500 });
  }

  if (!updatedTenant) {
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to update tenant.' } }, { status: 500 });
  }

  // Attempt Airtable sync (soft failure)
  const tableName = process.env['AIRTABLE_TABLE_RESIDENTES'] ?? null;
  let syncStatus: 'synced' | 'failed' | 'skipped' = 'skipped';
  let airtableSynced = false;

  if (tableName) {
    try {
      const newFullName = (data.full_name ?? existing.fullName) ?? '';
      const [firstPart, ...rest] = newFullName.split(' ');
      const firstName = firstPart ?? '';
      const lastName  = rest.join(' ');

      const result = await upsertAirtableResidente(
        {
          first_name:              firstName,
          last_name:               lastName,
          email:                   (data.email ?? existing.email) ?? '',
          phone:                   (data.phone ?? existing.phone) ?? '',
          dni:                     data.document_number !== undefined ? (data.document_number ?? undefined) : (existing.documentNumber ?? undefined),
          birth_date:              data.date_of_birth !== undefined ? (data.date_of_birth ?? undefined) : (existing.dateOfBirth ?? undefined),
          emergency_contact_name:  data.emergency_contact_name !== undefined ? data.emergency_contact_name : existing.emergencyContactName,
          emergency_contact_phone: data.emergency_contact_phone !== undefined ? data.emergency_contact_phone : existing.emergencyContactPhone,
        },
        existing.airtableExternalId ?? null
      );

      await db.update(tenants).set({
        airtableExternalId: result.airtableRecordId,
        syncStatus:         'synced',
        lastSyncedAt:       now,
      }).where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));

      syncStatus = 'synced';
      airtableSynced = true;
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[api/admin/tenants PATCH] Airtable sync failed', { errName, tenantId });
      await db.update(tenants).set({ syncStatus: 'failed' }).where(and(eq(tenants.id, tenantId), eq(tenants.orgId, ctx.orgId)));
      syncStatus = 'failed';
    }
  }

  return NextResponse.json({ tenant: updatedTenant, syncStatus, airtableSynced });
}
