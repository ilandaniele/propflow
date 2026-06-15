/**
 * GET  /api/admin/tenants  — paginated tenant list for admin
 * POST /api/admin/tenants  — create new tenant (admin-only)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, ilike, or, count as drizzleCount } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, units, properties } from '@/lib/db/schema';
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

  try {
    const conditions: ReturnType<typeof eq>[] = [eq(tenants.orgId, ctx.orgId)];
    if (sync_status) conditions.push(eq(tenants.syncStatus, sync_status));

    const baseWhere = search
      ? and(and(...conditions), or(ilike(tenants.fullName, `%${search}%`), ilike(tenants.email, `%${search}%`)))
      : and(...conditions);

    const [rows, countRows] = await Promise.all([
      db.select({
        id:                 tenants.id,
        fullName:           tenants.fullName,
        email:              tenants.email,
        phone:              tenants.phone,
        syncStatus:         tenants.syncStatus,
        lastSyncedAt:       tenants.lastSyncedAt,
        airtableExternalId: tenants.airtableExternalId,
        portalAccess:       tenants.portalAccess,
        unitId:             tenants.unitId,
        createdAt:          tenants.createdAt,
        unitLabel:          units.label,
        propertyName:       properties.name,
      })
        .from(tenants)
        .leftJoin(units, eq(units.id, tenants.unitId))
        .leftJoin(properties, eq(properties.id, units.propertyId))
        .where(baseWhere)
        .orderBy(tenants.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: drizzleCount() }).from(tenants).where(baseWhere),
    ]);

    return NextResponse.json({ tenants: rows, total: Number(countRows[0]?.total ?? 0), page });
  } catch (err) {
    console.error('[api/admin/tenants GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tenants.' } }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateTenantSchema = tenantRegistrationSchema
  .omit({ terms_accepted: true, privacy_accepted: true })
  .extend({
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
  const existing = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.orgId, ctx.orgId), eq(tenants.email, data.email)))
    .then(r => r[0] ?? null);

  if (existing) {
    return NextResponse.json(
      { error: { code: 'DUPLICATE_TENANT', message: 'A tenant with this email already exists.' } },
      { status: 409 }
    );
  }

  const fullName = `${data.first_name} ${data.last_name}`.trim();
  const now = new Date();

  let tenant: { id: string; email: string | null; fullName: string; syncStatus: string; airtableExternalId: string | null } | null = null;
  try {
    const rows = await db.insert(tenants).values({
      orgId:                ctx.orgId,
      fullName,
      email:                data.email,
      phone:                data.phone,
      documentNumber:       data.dni,
      dateOfBirth:          data.birth_date,
      emergencyContactName:  data.emergency_contact_name ?? null,
      emergencyContactPhone: data.emergency_contact_phone ?? null,
      responsableId:        data.responsable_id ?? null,
      syncStatus:           'pending',
    }).returning({
      id:                 tenants.id,
      email:              tenants.email,
      fullName:           tenants.fullName,
      syncStatus:         tenants.syncStatus,
      airtableExternalId: tenants.airtableExternalId,
    });
    tenant = rows[0] ?? null;
  } catch (err) {
    console.error('[api/admin/tenants POST] insert failed', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INSERT_FAILED', message: 'Failed to create tenant.' } }, { status: 500 });
  }

  if (!tenant) {
    return NextResponse.json({ error: { code: 'INSERT_FAILED', message: 'Failed to create tenant.' } }, { status: 500 });
  }

  // Attempt Airtable sync (soft failure)
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

      await db.update(tenants).set({
        airtableExternalId: result.airtableRecordId,
        syncStatus:         'synced',
        lastSyncedAt:       now,
      }).where(eq(tenants.id, tenant.id));

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
