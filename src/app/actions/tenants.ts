'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreateTenantSchema, UpdateTenantSchema, AssignTenantToUnitSchema } from '@/lib/schemas/tenant';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

export async function createTenant(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateTenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();
  const { error } = await supabase.from('tenants').insert({
    ...parsed.data,
    org_id: ctx.orgId,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    notes: parsed.data.notes || null,
  });

  if (error) {
    log.error('[createTenant] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_tenant', 'tenant');
  revalidatePath('/dashboard/tenants');
  return ok(undefined);
}

export async function updateTenant(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateTenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from('tenants')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenant] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_tenant', 'tenant', id);
  revalidatePath('/dashboard/tenants');
  revalidatePath(`/dashboard/tenants/${id}`);
  return ok(undefined);
}

export async function assignTenantToUnit(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = AssignTenantToUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify both tenant and unit belong to this org (RLS enforces, but explicit check for 404)
  const [tenantRes, unitRes] = await Promise.all([
    supabase.from('tenants').select('id').eq('id', parsed.data.tenant_id).eq('org_id', ctx.orgId).single(),
    supabase.from('units').select('id, status').eq('id', parsed.data.unit_id).eq('org_id', ctx.orgId).single(),
  ]);

  if (!tenantRes.data) return Errors.NOT_FOUND();
  if (!unitRes.data) return Errors.NOT_FOUND();

  // Update tenant's unit_id and flip unit to occupied
  const [tenantUpdate, unitUpdate] = await Promise.all([
    supabase.from('tenants').update({ unit_id: parsed.data.unit_id, updated_at: new Date().toISOString() }).eq('id', parsed.data.tenant_id),
    supabase.from('units').update({ status: 'occupied', updated_at: new Date().toISOString() }).eq('id', parsed.data.unit_id),
  ]);

  if (tenantUpdate.error || unitUpdate.error) {
    log.error('[assignTenantToUnit] db error', { tenantErr: tenantUpdate.error?.code, unitErr: unitUpdate.error?.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'assign_tenant_to_unit', 'tenant', parsed.data.tenant_id);
  revalidatePath('/dashboard/tenants');
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
