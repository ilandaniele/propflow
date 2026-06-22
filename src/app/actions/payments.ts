'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { contracts, tenants, payments, charges } from '@/lib/db/schema';
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
  const contractRows = await db
    .select({ id: contracts.id, tenantId: contracts.tenantId })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  if (!contractRows[0]) return Errors.NOT_FOUND();
  const contract = contractRows[0];

  // If the caller is a tenant, verify it's their own contract
  if (ctx.role === 'tenant') {
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
      .limit(1);

    if (!tenantRows[0] || contract.tenantId !== tenantRows[0].id) {
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
  } catch (e) {
    log.error('[recordPayment] db error', { code: e instanceof Error ? e.message : String(e) });
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
  const paymentRows = await db
    .select({ id: payments.id, status: payments.status })
    .from(payments)
    .where(and(eq(payments.id, parsed.data.payment_id), eq(payments.orgId, ctx.orgId)))
    .limit(1);

  if (!paymentRows[0]) return Errors.NOT_FOUND();
  if (paymentRows[0].status === 'approved') return Errors.CONFLICT('Payment is already approved');

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
  } catch (e) {
    log.error('[approvePayment] db error', { code: e instanceof Error ? e.message : String(e) });
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

  // Verify contract belongs to this org
  const contractRows = await db
    .select({ id: contracts.id, tenantId: contracts.tenantId })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  if (!contractRows[0]) return Errors.NOT_FOUND();

  // B5: Always derive tenant_id from the fetched contract server-side.
  try {
    await db.insert(charges).values({
      orgId: ctx.orgId,
      contractId: parsed.data.contract_id,
      tenantId: contractRows[0].tenantId,
      amount: String(parsed.data.amount),
      description: parsed.data.description,
      period: parsed.data.period || null,
      dueDate: parsed.data.due_date || null,
    });
  } catch (e) {
    log.error('[createCharge] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_charge', 'charge');
  revalidatePath('/dashboard/payments');
  return ok(undefined);
}
