'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreateContractSchema, UpdateContractStatusSchema } from '@/lib/schemas/contract';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

export async function createContract(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify tenant and unit belong to this org
  const [tenantRes, unitRes] = await Promise.all([
    supabase.from('tenants').select('id').eq('id', parsed.data.tenant_id).eq('org_id', ctx.orgId).single(),
    supabase.from('units').select('id').eq('id', parsed.data.unit_id).eq('org_id', ctx.orgId).single(),
  ]);

  if (!tenantRes.data || !unitRes.data) return Errors.NOT_FOUND();

  const { error } = await supabase.from('contracts').insert({
    ...parsed.data,
    org_id: ctx.orgId,
    deposit: parsed.data.deposit ?? null,
    status: 'active',
  });

  if (error) {
    log.error('[createContract] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_contract', 'contract');
  revalidatePath('/dashboard/contracts');
  return ok(undefined);
}

export async function updateContractStatus(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateContractStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify contract belongs to this org (RLS + explicit check)
  const { data: existing } = await supabase
    .from('contracts')
    .select('id, status')
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!existing) return Errors.NOT_FOUND();

  const { error } = await supabase
    .from('contracts')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateContractStatus] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_contract_status', 'contract', parsed.data.id);
  revalidatePath('/dashboard/contracts');
  return ok(undefined);
}
