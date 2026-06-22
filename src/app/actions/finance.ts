'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { expenseCategories, expenses, receiptUploads, payments, properties, units } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { uploadFile } from '@/lib/storage';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import {
  CreateExpenseCategorySchema,
  CreateExpenseSchema,
  UpdateExpenseSchema,
  MatchReceiptSchema,
} from '@/lib/schemas/finance';

export async function createExpenseCategory(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-expense-category');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreateExpenseCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(expenseCategories).values({
      orgId: ctx.orgId,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('unique') || msg.includes('23505')) return Errors.CONFLICT('Category name already exists');
    log.error('[createExpenseCategory] db error', { code: msg });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_expense_category', 'expense_category');
  revalidatePath('/dashboard/finance/expenses/categories');
  revalidatePath('/dashboard/finance');
  return ok(undefined);
}

export async function createExpense(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-expense');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CreateExpenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Validate property/unit/category belong to org (if provided)
  if (parsed.data.property_id) {
    const rows = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, parsed.data.property_id), eq(properties.orgId, ctx.orgId))).limit(1);
    if (!rows[0]) return Errors.NOT_FOUND();
  }
  if (parsed.data.unit_id) {
    const rows = await db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId))).limit(1);
    if (!rows[0]) return Errors.NOT_FOUND();
  }
  if (parsed.data.category_id) {
    const rows = await db.select({ id: expenseCategories.id }).from(expenseCategories)
      .where(and(eq(expenseCategories.id, parsed.data.category_id), eq(expenseCategories.orgId, ctx.orgId))).limit(1);
    if (!rows[0]) return Errors.NOT_FOUND();
  }

  try {
    await db.insert(expenses).values({
      orgId: ctx.orgId,
      propertyId: parsed.data.property_id ?? null,
      unitId: parsed.data.unit_id ?? null,
      categoryId: parsed.data.category_id ?? null,
      amount: parsed.data.amount,
      description: parsed.data.description,
      incurredOn: parsed.data.incurred_on,
      receiptPath: parsed.data.receipt_path ?? null,
    });
  } catch (e) {
    log.error('[createExpense] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_expense', 'expense');
  revalidatePath('/dashboard/finance');
  return ok(undefined);
}

export async function updateExpense(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-expense');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateExpenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify expense belongs to org
  const existing = await db.select({ id: expenses.id }).from(expenses)
    .where(and(eq(expenses.id, parsed.data.id), eq(expenses.orgId, ctx.orgId))).limit(1);
  if (!existing[0]) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  try {
    await db
      .update(expenses)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(expenses.id, id), eq(expenses.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateExpense] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/finance');
  return ok(undefined);
}

export async function uploadReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<{ receiptId: string; filePath: string }>> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'upload-receipt');
  if (!rl.success) return Errors.RATE_LIMITED();

  const file = formData.get('file') as File | null;
  if (!file) return Errors.VALIDATION_ERROR({ formErrors: ['No file provided'], fieldErrors: {} });

  const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  const MAX_SIZE = 5 * 1024 * 1024;

  if (!ALLOWED_MIMES.includes(file.type)) {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid file type. Allowed: PNG, JPEG, WebP, PDF'], fieldErrors: {} });
  }
  if (file.size > MAX_SIZE) {
    return Errors.VALIDATION_ERROR({ formErrors: ['File must be ≤ 5 MB'], fieldErrors: {} });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const uuid = crypto.randomUUID();
  const filePath = `${ctx.orgId}/uploads/${uuid}.${ext}`;

  let uploadErr: string | undefined;
  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await uploadFile('receipts', filePath, fileBuffer, file.type, false);
  } catch (err) {
    uploadErr = err instanceof Error ? err.message : String(err);
  }

  if (uploadErr) {
    log.error('[uploadReceipt] storage error', { code: uploadErr });
    return Errors.INTERNAL();
  }

  let receiptId: string;
  try {
    const rows = await db
      .insert(receiptUploads)
      .values({
        orgId: ctx.orgId,
        uploadedBy: ctx.userId,
        filePath,
        ocrStatus: 'pending',
      })
      .returning({ id: receiptUploads.id });

    if (!rows[0]) throw new Error('No row returned');
    receiptId = rows[0].id;
  } catch (e) {
    log.error('[uploadReceipt] insert error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.info('[uploadReceipt] receipt uploaded', { userId: ctx.userId, receiptId });
  revalidatePath('/dashboard/finance/receipts');
  revalidatePath('/portal/payments');
  return ok({ receiptId, filePath });
}

export async function matchReceiptToPayment(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'match-receipt');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = MatchReceiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify both rows belong to this org
  const [receiptRows, paymentRows] = await Promise.all([
    db.select({ id: receiptUploads.id }).from(receiptUploads)
      .where(and(eq(receiptUploads.id, parsed.data.receipt_id), eq(receiptUploads.orgId, ctx.orgId))).limit(1),
    db.select({ id: payments.id }).from(payments)
      .where(and(eq(payments.id, parsed.data.payment_id), eq(payments.orgId, ctx.orgId))).limit(1),
  ]);

  if (!receiptRows[0]) return Errors.NOT_FOUND();
  if (!paymentRows[0]) return Errors.NOT_FOUND();

  try {
    await db
      .update(receiptUploads)
      .set({
        paymentId: parsed.data.payment_id,
        ocrStatus: 'matched',
        updatedAt: new Date(),
      })
      .where(and(eq(receiptUploads.id, parsed.data.receipt_id), eq(receiptUploads.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[matchReceiptToPayment] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'match_receipt', 'receipt_upload', parsed.data.receipt_id);
  revalidatePath('/dashboard/finance/receipts');
  return ok(undefined);
}
