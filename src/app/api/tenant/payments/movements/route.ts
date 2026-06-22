/**
 * GET /api/tenant/payments/movements
 * Returns payment rows for the authenticated tenant with running balance computed
 * at the application layer.
 *
 * Tenant identity is ALWAYS derived from session — never from client params (AC8).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments, tenants, contracts, properties, units } from '@/lib/db/schema';
import { eq, and, asc, desc, gte, lte } from 'drizzle-orm';

const QuerySchema = z.object({
  status:    z.string().optional(),
  period:    z.string().regex(/^\d{4}-\d{2}$/).optional(),
  date_from: z.string().optional(),
  date_to:   z.string().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(50),
  sort_by:   z.enum(['paid_at', 'due_date', 'amount']).default('paid_at'),
  sort_dir:  z.enum(['asc', 'desc']).default('asc'),
});

// Movement types that reduce balance (debit from what tenant owes)
const CREDIT_TYPES = new Set(['payment', 'partial_payment', 'refund', 'discount', 'adjustment']);

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

  const { status, date_from, date_to, page, limit, sort_dir } = parsed.data;
  const offset = (page - 1) * limit;

  // Derive tenant_id from session (never from URL params) — AC8
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (tenantRows.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  const tenantId = tenantRows[0].id;

  // Build where conditions
  const conditions = [
    eq(payments.tenantId, tenantId),
    eq(payments.orgId, ctx.orgId),  // AC8: org isolation
  ];
  if (status)    conditions.push(eq(payments.status, status));
  // NOTE: payments schema has no periodMonth or dueDate columns.
  // TODO(W1/schema): add period_month + due_date to payments table, then restore these filters.
  // if (period)    conditions.push(eq(payments.periodMonth, period));  // schema missing field
  if (date_from) conditions.push(gte(payments.paidAt, date_from));
  if (date_to)   conditions.push(lte(payments.paidAt, date_to));

  const whereClause = and(...conditions);

  // Fetch ALL rows for running balance computation, then paginate in memory
  const sortOrder = sort_dir === 'asc' ? asc(payments.paidAt) : desc(payments.paidAt);

  const allRows = await db
    .select({
      id:            payments.id,
      amount:        payments.amount,
      currency:      payments.currency,
      paidAt:        payments.paidAt,
      // NOTE: dueDate, periodMonth, notes not in current payments schema (TODO W1/schema)
      status:        payments.status,
      method:        payments.method,
      reference:     payments.reference,
      movementType:  payments.movementType,
      receiptUrl:    payments.receiptUrl,
      createdAt:     payments.createdAt,
      updatedAt:     payments.updatedAt,
      propertyName:  properties.name,
      unitLabel:     units.label,
    })
    .from(payments)
    .leftJoin(contracts,  eq(payments.contractId, contracts.id))
    .leftJoin(units,      eq(contracts.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .where(whereClause)
    .orderBy(sortOrder, asc(payments.createdAt));

  // Compute running balance at application layer
  let runningBalance = 0;
  const withBalance = allRows.map(row => {
    const amount  = Number(row.amount ?? 0);
    const movType = row.movementType ?? '';
    if (CREDIT_TYPES.has(movType)) {
      runningBalance -= amount;
    } else {
      runningBalance += amount;
    }
    return {
      id:             row.id,
      amount:         row.amount,
      currency:       row.currency,
      paid_at:        row.paidAt,
      due_date:       null,        // TODO(W1/schema): not in payments schema
      status:         row.status,
      method:         row.method,
      reference:      row.reference,
      period_month:   null,        // TODO(W1/schema): not in payments schema
      movement_type:  row.movementType,
      receipt_url:    row.receiptUrl,
      notes:          null,        // TODO(W1/schema): not in payments schema
      created_at:     row.createdAt,
      updated_at:     row.updatedAt,
      property_name:  row.propertyName ?? null,
      unit_label:     row.unitLabel ?? null,
      running_balance: runningBalance,
      is_credit:      CREDIT_TYPES.has(movType),
    };
  });

  const total     = withBalance.length;
  const page_rows = withBalance.slice(offset, offset + limit);

  return NextResponse.json({ movements: page_rows, total, page });
}
