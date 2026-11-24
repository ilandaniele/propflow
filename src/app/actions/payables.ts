'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expenseCategories, payablePayments, payables, properties } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { isConstraintError } from '@/lib/db/errors';
import { CreatePayableSchema, RegisterPayablePaymentSchema } from '@/lib/schemas/payables';
import { payableSaldoCents } from '@/lib/finance/payables/queries';
import { toCents } from '@/lib/finance/payables/status';

const PAYABLES_PATH = '/dashboard/finance/payables';

const overpaid = () => Errors.VALIDATION_ERROR({ fieldErrors: { amount: ['Amount exceeds the outstanding balance'] }, formErrors: [] });

function revalidatePayables() {
  revalidatePath(PAYABLES_PATH);
  revalidatePath('/dashboard/finance');
}

async function belongsToOrg(table: typeof properties | typeof expenseCategories, id: string, orgId: string) {
  const rows = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), eq(table.orgId, orgId))).limit(1);
  return Boolean(rows[0]);
}

export async function createPayable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-payable');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreatePayableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  if (data.property_id && !(await belongsToOrg(properties, data.property_id, ctx.orgId))) return Errors.NOT_FOUND();
  if (data.category_id && !(await belongsToOrg(expenseCategories, data.category_id, ctx.orgId))) return Errors.NOT_FOUND();

  let id: string | undefined;
  try {
    const [row] = await db.insert(payables).values({
      orgId: ctx.orgId,
      propertyId: data.property_id ?? null,
      categoryId: data.category_id ?? null,
      supplierName: data.supplier_name,
      description: data.description ?? null,
      documentRef: data.document_ref ?? null,
      amount: data.amount.toFixed(2),
      issuedOn: data.issued_on,
      dueOn: data.due_on,
    }).returning({ id: payables.id });
    id = row?.id;
  } catch (e) {
    log.error('[createPayable] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_payable', 'payable', id);
  revalidatePayables();
  return ok(undefined);
}

export async function registerPayablePayment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'register-payable-payment');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RegisterPayablePaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const data = parsed.data;

  const saldo = await payableSaldoCents(ctx.orgId, data.payable_id);
  if (saldo === null) return Errors.NOT_FOUND();
  if (toCents(data.amount) > saldo) return overpaid();

  try {
    await db.insert(payablePayments).values({
      payableId: data.payable_id,
      orgId: ctx.orgId,
      amount: data.amount.toFixed(2),
      paidOn: data.paid_on,
      note: data.note ?? null,
    });
  } catch (e) {
    if (isConstraintError(e, 'payable_overpaid')) return overpaid();
    log.error('[registerPayablePayment] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'register_payable_payment', 'payable', data.payable_id);
  revalidatePayables();
  return ok(undefined);
}
