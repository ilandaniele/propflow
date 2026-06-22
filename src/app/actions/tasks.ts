'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { tenants, tenantTasks, taskProofs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
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

  // Verify tenant belongs to this org
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) return Errors.NOT_FOUND();

  let taskId: string;
  try {
    const rows = await db
      .insert(tenantTasks)
      .values({
        orgId: ctx.orgId,
        tenantId: parsed.data.tenant_id,
        createdBy: ctx.userId,
        taskType: parsed.data.task_type,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        dueAt: new Date(parsed.data.due_at),
        status: 'pending',
      })
      .returning({ id: tenantTasks.id });

    if (!rows[0]) throw new Error('No row returned');
    taskId = rows[0].id;
  } catch (e) {
    log.error('[createTenantTask] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_task', 'tenant_task', taskId);
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

  try {
    await db
      .update(tenantTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tenantTasks.id, id), eq(tenantTasks.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateTenantTask] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db
      .update(tenantTasks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(tenantTasks.id, parsed.data.id), eq(tenantTasks.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[cancelTenantTask] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db
      .update(taskProofs)
      .set({ adminDecision: decision })
      .where(and(eq(taskProofs.id, proofId), eq(taskProofs.orgId, ctx.orgId)));

    if (decision === 'accepted') {
      await db
        .update(tenantTasks)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tenantTasks.id, taskId), eq(tenantTasks.orgId, ctx.orgId)));
    }
  } catch (e) {
    log.error('[verifyTaskProofAdminOverride] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, `task_proof_${decision}`, 'task_proof', proofId);
  revalidatePath('/dashboard/tasks');
  return ok(undefined);
}
