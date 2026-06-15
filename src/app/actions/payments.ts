'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { contracts, payments, tenants, charges } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

  // Verify the contract belongs to this user's org
  const contract = await db.select({ id: contracts.id, tenantId: contracts.tenantId, orgId: contracts.orgId })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!contract) return Errors.NOT_FOUND();

  // If the caller is a tenant, verify it's their own contract
  if (ctx.role === 'tenant') {
    const tenantRow = await db.select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
      .then(r => r[0] ?? null);

    if (!tenantRow || contract.tenantId !== tenantRow.id) {
      return Errors.FORBIDDEN();
    }
  }

  try {
    await db.insert(payments).values({
      orgId: ctx.orgId,
      contractId: parsed.data.contract_id,
      tenantId: contract.tenantId,
      amount: String(parsed.data.amount),
      paidAt: parsed.data.paid_at,
      method: parsed.data.method,
      reference: parsed.data.reference || null,
      status: 'pending',
    });
  } catch (err) {
    log.error('[recordPayment] db error', { err: err instanceof Error ? err.message : String(err) });
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
    return Errors.FORBIDDEN();
  }

  const parsed = ApprovePaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify payment belongs to this org
  const payment = await db.select({ id: payments.id, status: payments.status, orgId: payments.orgId })
    .from(payments)
    .where(and(eq(payments.id, parsed.data.payment_id), eq(payments.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!payment) return Errors.NOT_FOUND();
  if (payment.status === 'approved') return Errors.CONFLICT('Payment is already approved');

  try {
    await db
      .update(payments)
      .set({
        status: 'approved',
        approvedBy: ctx.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, parsed.data.payment_id), eq(payments.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[approvePayment] db error', { err: err instanceof Error ? err.message : String(err) });
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

  // Verify contract belongs to this org; derive tenant_id server-side (IDOR guard)
  const contract = await db.select({ id: contracts.id, tenantId: contracts.tenantId })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!contract) return Errors.NOT_FOUND();

  try {
    await db.insert(charges).values({
      orgId: ctx.orgId,
      contractId: parsed.data.contract_id,
      tenantId: contract.tenantId,
      amount: String(parsed.data.amount),
      description: parsed.data.description,
      period: parsed.data.period || null,
      dueDate: parsed.data.due_date || null,
    });
  } catch (err) {
    log.error('[createCharge] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_charge', 'charge');
  revalidatePath('/dashboard/payments');
  return ok(undefined);
}
