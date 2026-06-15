/**
 * GET /api/tenant/payments
 * Returns paginated payment list for the authenticated tenant.
 * Tenant identity is derived from session — never from client params.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

const QuerySchema = z.object({
  status:    z.string().optional(),
  period:    z.string().regex(/^\d{4}-\d{2}$/).optional(),
  date_from: z.string().optional(),
  date_to:   z.string().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
  sort_by:   z.enum(['paid_at', 'due_date', 'amount']).default('paid_at'),
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

  const { status, period, date_from, date_to, page, limit, sort_by, sort_dir } = parsed.data;
  const offset = (page - 1) * limit;

  // Derive tenant_id from session (never from URL params)
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

  let query = admin
    .from('payments')
    .select(
      `id, amount, currency, paid_at, due_date, status, method, reference,
       period_month, movement_type, receipt_url, notes, created_at, updated_at,
       contracts!inner(property_id, properties(name), units(label))`,
      { count: 'exact' }
    )
    .eq('tenant_id', tenantRecord.id)
    .eq('org_id', ctx.orgId)
    .order(sort_by, { ascending: sort_dir === 'asc' })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (period) query = query.eq('period_month', period);
  if (date_from) query = query.gte('paid_at', date_from);
  if (date_to) query = query.lte('paid_at', date_to);

  const { data: payments, count, error } = await query;

  if (error) {
    console.error('[api/tenant/payments GET]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payments.' } }, { status: 500 });
  }

  // Flatten nested joins
  const rows = (payments ?? []).map((p: Record<string, unknown>) => {
    const contract = p.contracts as Record<string, unknown> | null;
    const property = contract?.properties as Record<string, unknown> | null;
    const unit = contract?.units as Record<string, unknown> | null;
    return {
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      paid_at: p.paid_at,
      due_date: p.due_date,
      status: p.status,
      method: p.method,
      reference: p.reference,
      period_month: p.period_month,
      movement_type: p.movement_type,
      receipt_url: p.receipt_url,
      notes: p.notes,
      created_at: p.created_at,
      updated_at: p.updated_at,
      property_name: property?.name ?? null,
      unit_label: unit?.label ?? null,
    };
  });

  return NextResponse.json({ payments: rows, total: count ?? 0, page });
}
