'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { VisitorLogSchema, UpdateVisitorLogSchema } from '@/lib/schemas/community';

export async function createVisitorLog(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-visitor-log');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = VisitorLogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // For tenant callers: validate that the unit belongs to their active contract (IC-E3)
  let unitId = parsed.data.unit_id ?? null;
  if (ctx.role === 'tenant') {
    // Derive unit from tenant's active contract
    const { data: contracts } = await supabase
      .from('contracts')
      .select('unit_id')
      .eq('org_id', ctx.orgId)
      .eq('status', 'active')
      .in('tenant_id', (
        await supabase.from('tenants').select('id').eq('profile_id', ctx.userId).eq('org_id', ctx.orgId)
      ).data?.map((t: { id: string }) => t.id) ?? [])
      .limit(1);

    const tenantUnitId = contracts?.[0]?.unit_id;
    if (!tenantUnitId) return Errors.FORBIDDEN();

    // Tenant can only log visitors for their own unit
    if (unitId && unitId !== tenantUnitId) return Errors.FORBIDDEN();
    unitId = tenantUnitId;
  }

  const { error } = await supabase.from('visitor_logs').insert({
    org_id: ctx.orgId,
    property_id: parsed.data.property_id ?? null,
    unit_id: unitId,
    visitor_name: parsed.data.visitor_name,
    host_tenant_id: parsed.data.host_tenant_id ?? null,
    visit_date: parsed.data.visit_date,
    entry_time: parsed.data.entry_time ?? null,
    purpose: parsed.data.purpose ?? null,
    created_by: ctx.userId,
    notes: parsed.data.notes ?? null,
  });

  if (error) {
    log.error('[createVisitorLog] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/visitors');
  revalidatePath('/portal/visitors/new');
  return ok(undefined);
}

export async function updateVisitorLog(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-visitor-log');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateVisitorLogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('visitor_logs').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  const { error } = await supabase.from('visitor_logs').update({
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateVisitorLog] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/visitors');
  return ok(undefined);
}
