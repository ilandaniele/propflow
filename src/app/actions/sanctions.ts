'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { emit } from '@/lib/events/emit';
import { ProposeSanctionSchema, ApproveSanctionSchema, RejectSanctionSchema, DisputeSanctionSchema } from '@/lib/schemas/sanction';
import type { ActionResult } from '@/lib/errors';

export async function proposeSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'propose_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ProposeSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify tenant belongs to org
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', parsed.data.tenant_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) return Errors.NOT_FOUND();

  const { data: sanction, error } = await supabase
    .from('sanctions')
    .insert({
      org_id: ctx.orgId,
      tenant_id: parsed.data.tenant_id,
      proposed_by: ctx.userId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      reason: parsed.data.reason,
      amount: parsed.data.amount ?? null,
      status: 'proposed',
    })
    .select('id')
    .single();

  if (error || !sanction) {
    log.error('[proposeSanction] db error', { code: error?.code });
    return Errors.INTERNAL();
  }

  emit('sanction.proposed', {
    orgId: ctx.orgId,
    sanctionId: sanction.id,
    tenantId: parsed.data.tenant_id,
    kind: parsed.data.kind,
    amount: parsed.data.amount ?? null,
  }, `sanction.proposed:${sanction.id}`);

  log.adminAction(ctx.userId, 'propose_sanction', 'sanction', sanction.id);
  revalidatePath('/dashboard/sanctions');
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function approveSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'approve_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ApproveSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Fetch the sanction
  const { data: sanction } = await supabase
    .from('sanctions')
    .select('id, org_id, tenant_id, kind, amount, status, linked_charge_id, title, reason')
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!sanction) return Errors.NOT_FOUND();
  if (sanction.status !== 'proposed') {
    return Errors.CONFLICT('Sanction is not in proposed status');
  }
  if (sanction.linked_charge_id) {
    return Errors.CONFLICT('Sanction already has a linked charge');
  }

  let chargeId: string | null = null;

  // For monetary sanctions: find active contract and create charge (transaction-scoped)
  if (sanction.kind === 'monetary' && sanction.amount) {
    const { data: contract } = await supabase
      .from('contracts')
      .select('id')
      .eq('tenant_id', sanction.tenant_id)
      .eq('org_id', ctx.orgId)
      .eq('status', 'active')
      .limit(1)
      .single();

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    const { data: charge, error: chargeError } = await supabase
      .from('charges')
      .insert({
        org_id: ctx.orgId,
        contract_id: contract?.id ?? null,
        tenant_id: sanction.tenant_id,
        period,
        description: sanction.title,
        amount: sanction.amount,
        due_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single();

    if (chargeError || !charge) {
      log.error('[approveSanction] charge insert failed', { code: chargeError?.code });
      return Errors.INTERNAL();
    }

    chargeId = charge.id;
  }

  // Update sanction to approved + link charge (UNIQUE constraint prevents double-charge)
  const { error: updateError } = await supabase
    .from('sanctions')
    .update({
      status: 'approved',
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      linked_charge_id: chargeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sanction.id)
    .eq('org_id', ctx.orgId);

  if (updateError) {
    log.error('[approveSanction] update failed', { code: updateError.code });
    return Errors.INTERNAL();
  }

  emit('sanction.approved', {
    orgId: ctx.orgId,
    sanctionId: sanction.id,
    tenantId: sanction.tenant_id,
    chargeId,
  }, `sanction.approved:${sanction.id}`);

  log.adminAction(ctx.userId, 'approve_sanction', 'sanction', sanction.id);
  revalidatePath('/dashboard/sanctions');
  revalidatePath(`/dashboard/tenants/${sanction.tenant_id}`);
  return ok(undefined);
}

export async function rejectSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'reject_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RejectSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  const { error } = await supabase
    .from('sanctions')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId)
    .eq('status', 'proposed');

  if (error) {
    log.error('[rejectSanction] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'reject_sanction', 'sanction', parsed.data.id);
  revalidatePath('/dashboard/sanctions');
  return ok(undefined);
}

/**
 * Tenant disputes their own sanction (portal action).
 */
export async function disputeSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'dispute_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = DisputeSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Find tenant row for this profile
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) return Errors.NOT_FOUND();

  // Verify sanction belongs to this tenant and is in approved status
  const { data: sanction } = await supabase
    .from('sanctions')
    .select('id, status, tenant_id, org_id')
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!sanction) return Errors.NOT_FOUND();
  if (sanction.status !== 'approved') {
    return Errors.CONFLICT('Only approved sanctions can be disputed');
  }

  const { error } = await supabase
    .from('sanctions')
    .update({
      status: 'disputed',
      dispute_reason: parsed.data.dispute_reason,
      disputed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sanction.id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[disputeSanction] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  emit('sanction.disputed', {
    orgId: ctx.orgId,
    sanctionId: sanction.id,
    tenantId: tenant.id,
  }, `sanction.disputed:${sanction.id}`);

  revalidatePath('/portal/sanctions');
  return ok(undefined);
}
