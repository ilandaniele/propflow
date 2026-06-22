/**
 * GET /api/tenant/payments/summary
 * Returns aggregate payment totals for the authenticated tenant.
 * Tenant identity is ALWAYS derived from session — never from client params (AC8).
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
  }

  // Derive tenant_id from session — never from URL params (AC8)
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (tenantRows.length === 0) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  const tenantId = tenantRows[0].id;

  // Fetch payment totals — Drizzle (AC1, AC8: tenant_id + org_id)
  try {
    // NOTE: payments schema has no dueDate column (TODO W1/schema: add due_date).
    // pending_overdue distinction is not available without dueDate; all pending treated as pending.
    const rows = await db
      .select({
        amount:   payments.amount,
        currency: payments.currency,
        status:   payments.status,
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.orgId, ctx.orgId)));

    const currency = rows.find(r => r.currency)?.currency ?? 'PEN';

    const total_paid = rows
      .filter(r => r.status === 'approved')
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);

    const total_pending = rows
      .filter(r => r.status === 'pending' || r.status === 'under_review')
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);

    const total_overdue = 0; // TODO(W1/schema): requires due_date column in payments

    const current_balance = total_pending + total_overdue;

    return NextResponse.json({ total_paid, total_pending, total_overdue, current_balance, currency });
  } catch (err) {
    console.error('[api/tenant/payments/summary GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch summary.' } }, { status: 500 });
  }
}
