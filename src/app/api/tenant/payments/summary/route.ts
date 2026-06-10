/**
 * GET /api/tenant/payments/summary
 * Returns aggregate payment totals for the authenticated tenant.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tenantRecord, error: tenantError } = await admin
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (tenantError || !tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: payments, error } = await admin
    .from('payments')
    .select('amount, currency, status, due_date')
    .eq('tenant_id', tenantRecord.id)
    .eq('org_id', ctx.orgId);

  if (error) {
    console.error('[api/tenant/payments/summary GET]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch summary.' } }, { status: 500 });
  }

  const rows = payments ?? [];
  const currency = rows.find(r => r.currency)?.currency ?? 'PEN';

  const total_paid = rows
    .filter(r => r.status === 'approved')
    .reduce((s, r) => s + Number(r.amount), 0);

  const total_pending = rows
    .filter(r => r.status === 'pending' && r.due_date && r.due_date >= today)
    .reduce((s, r) => s + Number(r.amount), 0);

  const total_overdue = rows
    .filter(r => r.status === 'pending' && r.due_date && r.due_date < today)
    .reduce((s, r) => s + Number(r.amount), 0);

  const current_balance = total_pending + total_overdue;

  return NextResponse.json({ total_paid, total_pending, total_overdue, current_balance, currency });
}
