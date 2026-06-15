/**
 * GET  /api/admin/tenants  — paginated tenant list for admin
 * POST /api/admin/tenants  — create new tenant (admin-only)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, or, ilike, count as sqlCount, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';
import { upsertAirtableResidente } from '@/lib/airtable/write';

// ── GET ───────────────────────────────────────────────────────────────────────

const GetQuerySchema = z.object({
  search:      z.string().max(200).optional(),
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

  const { search, sync_status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  // Build where conditions
  const baseConditions = [eq(tenants.orgId, ctx.orgId)];
  if (sync_status) baseConditions.push(eq(tenants.syncStatus, sync_status));

  const whereClause = search
    ? and(
        ...baseConditions,
        or(
          ilike(tenants.fullName, `%${search}%`),
          ilike(tenants.email!, `%${search}%`),
        ),
      )
    : and(...baseConditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id:                 tenants.id,
        fullName:           tenants.fullName,
        email:              tenants.email,
        phone:              tenants.phone,
        documentNumber:     tenants.documentNumber,
        syncStatus:         tenants.syncStatus,
        lastSyncedAt:       tenants.lastSyncedAt,
        airtableExternalId: tenants.airtableExternalId,
        portalAccess:       tenants.portalAccess,
        unitId:             tenants.unitId,
        createdAt:          tenants.createdAt,
      })
      .from(tenants)
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: sqlCount() }).from(tenants).where(whereClause),
  ]);

  const total = Number(countRows[0]?.value ?? 0);

  return NextResponse.json({ tenants: rows, total, page });
}

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateTenantSchema = tenantRegistrationSchema
  .omit({ terms_accepted: true, privacy_accepted: true })
  .extend({
    notes:          z.string().max(5000).optional(),
    responsable_id: z.string().uuid().optional(),
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

  // Check for duplicate email in org
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.orgId, ctx.orgId), eq(tenants.email!, data.email)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists.' } },
      { status: 409 }
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`.trim();

  const [tenant] = await db
    .insert(tenants)
    .values({
      orgId:                ctx.orgId,
      fullName,
      email:                data.email,
      phone:                data.phone,
      documentNumber:       data.dni ?? null,
      dateOfBirth:          data.birth_date ?? null,
      emergencyContactName:  data.emergency_contact_name ?? null,
      emergencyContactPhone: data.emergency_contact_phone ?? null,
      notes:                data.notes ?? null,
      responsableId:        data.responsable_id ?? null,
      syncStatus:           'pending',
    })
    .returning({
      id:                 tenants.id,
      email:              tenants.email,
      fullName:           tenants.fullName,
      syncStatus:         tenants.syncStatus,
      airtableExternalId: tenants.airtableExternalId,
    });

  if (!tenant) {
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

      await db
        .update(tenants)
        .set({
          airtableExternalId: result.airtableRecordId,
          syncStatus:         'synced',
          lastSyncedAt:       new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      syncStatus = 'synced';
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'unknown';
      console.warn('[api/admin/tenants POST] Airtable sync failed', { errName, tenantId: tenant.id });
      await db.update(tenants).set({ syncStatus: 'failed' }).where(eq(tenants.id, tenant.id));
      syncStatus = 'failed';
    }
  }

  return NextResponse.json({ tenant, syncStatus }, { status: 201 });
}
