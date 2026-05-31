'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { CreateTenantTaskSchema, UpdateTenantTaskSchema, CancelTenantTaskSchema } from '@/lib/schemas/tenantTask';
import type { ActionResult } from '@/lib/errors';

export async function createTenantTask(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create_task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreateTenantTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify tenant belongs to this org
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) return Errors.NOT_FOUND();

  const { data: task, error } = await supabase
    .from('tenant_tasks')
    .insert({
      org_id: ctx.orgId,
      tenant_id: parsed.data.tenant_id,
      created_by: ctx.userId,
      task_type: parsed.data.task_type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      due_at: parsed.data.due_at,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !task) {
    log.error('[createTenantTask] db error', { code: error?.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_task', 'tenant_task', task.id);
  revalidatePath('/dashboard/tasks');
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function updateTenantTask(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update_task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateTenantTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateTenantTask] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_task', 'tenant_task', id);
  revalidatePath('/dashboard/tasks');
  return ok(undefined);
}

export async function cancelTenantTask(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'cancel_task');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CancelTenantTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_tasks')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[cancelTenantTask] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'cancel_task', 'tenant_task', parsed.data.id);
  revalidatePath('/dashboard/tasks');
  return ok(undefined);
}

export async function verifyTaskProofAdminOverride(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'verify_task_proof');
  if (!rl.success) return Errors.RATE_LIMITED();

  const proofId = formData.get('proof_id') as string;
  const taskId = formData.get('task_id') as string;
  const decision = formData.get('decision') as 'accepted' | 'rejected';

  if (!proofId || !taskId || !['accepted', 'rejected'].includes(decision)) {
    return Errors.VALIDATION_ERROR({ formErrors: ['proof_id, task_id, decision required'], fieldErrors: {} });
  }

  const supabase = await createClient();

  await supabase
    .from('task_proofs')
    .update({ admin_decision: decision })
    .eq('id', proofId)
    .eq('org_id', ctx.orgId);

  if (decision === 'accepted') {
    await supabase
      .from('tenant_tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .eq('org_id', ctx.orgId);
  }

  log.adminAction(ctx.userId, `task_proof_${decision}`, 'task_proof', proofId);
  revalidatePath('/dashboard/tasks');
  return ok(undefined);
}
