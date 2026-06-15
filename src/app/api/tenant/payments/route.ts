/**
 * GET /api/tenant/payments
 * Returns paginated payment list for the authenticated tenant.
 * Tenant identity is derived from session — never from client params.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, count as drizzleCount } from 'drizzle-orm';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, payments, contracts, units, properties } from '@/lib/db/schema';

const QuerySchema = z.object({
  status:   z.string().optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  // Derive tenant record from session — never from URL params (AC15 security)
  const tenantRecord = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  try {
    const conditions = [eq(payments.tenantId, tenantRecord.id), eq(payments.orgId, ctx.orgId)];
    if (status) conditions.push(eq(payments.status, status));
    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db.select({
        id:           payments.id,
        amount:       payments.amount,
        currency:     payments.currency,
        paidAt:       payments.paidAt,
        status:       payments.status,
        method:       payments.method,
        reference:    payments.reference,
        movementType: payments.movementType,
        receiptUrl:   payments.receiptUrl,
        createdAt:    payments.createdAt,
        updatedAt:    payments.updatedAt,
        propertyName: properties.name,
        unitLabel:    units.label,
      })
        .from(payments)
        .leftJoin(contracts, eq(contracts.id, payments.contractId))
        .leftJoin(units, eq(units.id, contracts.unitId))
        .leftJoin(properties, eq(properties.id, units.propertyId))
        .where(whereClause)
        .orderBy(payments.paidAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: drizzleCount() }).from(payments).where(whereClause),
    ]);

    return NextResponse.json({ payments: rows, total: Number(countRows[0]?.total ?? 0), page });
  } catch (err) {
    console.error('[api/tenant/payments GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payments.' } }, { status: 500 });
  }
}
