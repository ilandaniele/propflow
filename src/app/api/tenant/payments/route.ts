/**
 * GET /api/tenant/payments
 * Returns paginated payment list for the authenticated tenant.
 * Tenant identity is derived from session — never from client params.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, count as sqlCount, asc, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { payments, tenants, contracts, properties, units } from '@/lib/db/schema';
import { requireTenant } from '@/lib/auth/guards';

const QuerySchema = z.object({
  status:    z.string().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
  sort_by:   z.enum(['paidAt', 'amount']).default('paidAt'),
  sort_dir:  z.enum(['asc', 'desc']).default('desc'),
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

  const { status, page, limit, sort_dir } = parsed.data;
  const offset = (page - 1) * limit;

  // Derive tenant_id from session (never from URL params)
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (tenantRows.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  const tenantId = tenantRows[0].id;

  const baseConditions = [
    eq(payments.tenantId, tenantId),
    eq(payments.orgId, ctx.orgId),
  ];
  if (status) baseConditions.push(eq(payments.status, status));
  const whereClause = and(...baseConditions);

  const sortOrder = sort_dir === 'asc' ? asc(payments.paidAt) : desc(payments.paidAt);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id:           payments.id,
        amount:       payments.amount,
        currency:     payments.currency,
        paidAt:       payments.paidAt,
        status:       payments.status,
        method:       payments.method,
        reference:    payments.reference,
        receiptUrl:   payments.receiptUrl,
        movementType: payments.movementType,
        orgId:        payments.orgId,
        createdAt:    payments.createdAt,
        updatedAt:    payments.updatedAt,
        contractId:   payments.contractId,
        propertyName: properties.name,
        unitLabel:    units.label,
      })
      .from(payments)
      .leftJoin(contracts,   eq(payments.contractId, contracts.id))
      .leftJoin(properties,  eq(contracts.unitId,    properties.id))
      .leftJoin(units,       eq(contracts.unitId,    units.id))
      .where(whereClause)
      .orderBy(sortOrder)
      .limit(limit)
      .offset(offset),
    db.select({ value: sqlCount() }).from(payments).where(whereClause),
  ]);

  const total = Number(countRows[0]?.value ?? 0);

  const paymentList = rows.map(row => ({
    id:           row.id,
    amount:       row.amount,
    currency:     row.currency,
    paid_at:      row.paidAt,
    status:       row.status,
    method:       row.method,
    reference:    row.reference,
    receipt_url:  row.receiptUrl,
    movement_type: row.movementType,
    orgId:        row.orgId,
    created_at:   row.createdAt,
    updated_at:   row.updatedAt,
    property_name: row.propertyName ?? null,
    unit_label:   row.unitLabel ?? null,
  }));

  return NextResponse.json({ payments: paymentList, total, page });
}
