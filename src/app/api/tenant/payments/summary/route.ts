/**
 * GET /api/tenant/payments/summary
 * Returns aggregate payment totals for the authenticated tenant.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, payments } from '@/lib/db/schema';

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
  }

  // Derive tenant record from session — org-scoped
  const tenantRecord = await db.select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  try {
    const rows = await db.select({
      amount:   payments.amount,
      currency: payments.currency,
      status:   payments.status,
      paidAt:   payments.paidAt,
    })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantRecord.id), eq(payments.orgId, ctx.orgId)));

    const today = new Date().toISOString().split('T')[0];
    const currency = rows.find(r => r.currency)?.currency ?? 'PEN';

    const total_paid = rows
      .filter(r => r.status === 'approved')
      .reduce((s, r) => s + Number(r.amount), 0);

    const total_pending = rows
      .filter(r => r.status === 'pending' && r.paidAt && r.paidAt >= today)
      .reduce((s, r) => s + Number(r.amount), 0);

    const total_overdue = rows
      .filter(r => r.status === 'pending' && r.paidAt && r.paidAt < today)
      .reduce((s, r) => s + Number(r.amount), 0);

    const current_balance = total_pending + total_overdue;

    return NextResponse.json({ total_paid, total_pending, total_overdue, current_balance, currency });
  } catch (err) {
    console.error('[api/tenant/payments/summary GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch summary.' } }, { status: 500 });
  }
}
