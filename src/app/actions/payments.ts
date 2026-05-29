'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { RecordPaymentSchema, ApprovePaymentSchema, CreateChargeSchema } from '@/lib/schemas/payment';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

export async function recordPayment(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = RecordPaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify the contract belongs to this user's org
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, tenant_id, org_id')
    .eq('id', parsed.data.contract_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!contract) return Errors.NOT_FOUND();

  // If the caller is a tenant, verify it's their own contract
  if (ctx.role === 'tenant') {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('id')
      .eq('profile_id', ctx.userId)
      .eq('org_id', ctx.orgId)
      .single();

    if (!tenantRow || contract.tenant_id !== tenantRow.id) {
      return Errors.FORBIDDEN();
    }
  }

  const { error } = await supabase.from('payments').insert({
    org_id: ctx.orgId,
    contract_id: parsed.data.contract_id,
    tenant_id: contract.tenant_id,
    amount: parsed.data.amount,
    paid_at: parsed.data.paid_at,
    method: parsed.data.method,
    reference: parsed.data.reference || null,
    status: 'pending',
  });

  if (error) {
    log.error('[recordPayment] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/payments');
  revalidatePath('/portal/payments');
  return ok(undefined);
}

export async function approvePayment(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    // Could be FORBIDDEN (tenant trying to approve) or UNAUTHORIZED
    return Errors.FORBIDDEN();
  }

  const parsed = ApprovePaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify payment belongs to this org
  const { data: payment } = await supabase
    .from('payments')
    .select('id, status, org_id')
    .eq('id', parsed.data.payment_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!payment) return Errors.NOT_FOUND();
  if (payment.status === 'approved') return Errors.CONFLICT('Payment is already approved');

  const { error } = await supabase
    .from('payments')
    .update({
      status: 'approved',
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.payment_id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[approvePayment] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.paymentApproved(ctx.userId, parsed.data.payment_id, ctx.orgId);
  revalidatePath('/dashboard/payments');
  return ok(undefined);
}

export async function createCharge(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateChargeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // Verify contract belongs to this org
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, tenant_id')
    .eq('id', parsed.data.contract_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!contract) return Errors.NOT_FOUND();

  const { error } = await supabase.from('charges').insert({
    org_id: ctx.orgId,
    contract_id: parsed.data.contract_id,
    tenant_id: parsed.data.tenant_id,
    amount: parsed.data.amount,
    description: parsed.data.description,
    period: parsed.data.period || null,
    due_date: parsed.data.due_date || null,
  });

  if (error) {
    log.error('[createCharge] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_charge', 'charge');
  revalidatePath('/dashboard/payments');
  return ok(undefined);
}
