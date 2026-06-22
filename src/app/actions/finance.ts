'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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

  const supabase = await createClient();
  const { error } = await supabase.from('expense_categories').insert({
    org_id: ctx.orgId,
    name: parsed.data.name,
    color: parsed.data.color ?? null,
  });

  if (error) {
    if (error.code === '23505') return Errors.CONFLICT('Category name already exists');
    log.error('[createExpenseCategory] db error', { code: error.code });
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

  const supabase = await createClient();

  // Validate property/unit belong to org (if provided)
  if (parsed.data.property_id) {
    const { data: prop } = await supabase
      .from('properties').select('id').eq('id', parsed.data.property_id).eq('org_id', ctx.orgId).single();
    if (!prop) return Errors.NOT_FOUND();
  }
  if (parsed.data.unit_id) {
    const { data: unit } = await supabase
      .from('units').select('id').eq('id', parsed.data.unit_id).eq('org_id', ctx.orgId).single();
    if (!unit) return Errors.NOT_FOUND();
  }
  if (parsed.data.category_id) {
    const { data: cat } = await supabase
      .from('expense_categories').select('id').eq('id', parsed.data.category_id).eq('org_id', ctx.orgId).single();
    if (!cat) return Errors.NOT_FOUND();
  }

  const { error } = await supabase.from('expenses').insert({
    org_id: ctx.orgId,
    ...parsed.data,
  });

  if (error) {
    log.error('[createExpense] db error', { code: error.code });
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

  const supabase = await createClient();

  // Verify expense belongs to org
  const { data: existing } = await supabase
    .from('expenses').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;
  const { error } = await supabase
    .from('expenses').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateExpense] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/finance');
  return ok(undefined);
}

export async function uploadReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<{ receiptId: string; filePath: string }>> {
  // Both admin and tenant can upload receipts
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

  const supabase = await createClient();

  // Generate org-scoped path
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

  // Insert receipt_uploads row
  const { data: receiptRow, error: insertError } = await supabase
    .from('receipt_uploads')
    .insert({
      org_id: ctx.orgId,
      uploaded_by: ctx.userId,
      file_path: filePath,
      ocr_status: 'pending',
    })
    .select('id')
    .single();

  if (insertError || !receiptRow) {
    log.error('[uploadReceipt] insert error', { code: insertError?.code });
    return Errors.INTERNAL();
  }

  log.info('[uploadReceipt] receipt uploaded', { userId: ctx.userId, receiptId: receiptRow.id });
  revalidatePath('/dashboard/finance/receipts');
  revalidatePath('/portal/payments');
  return ok({ receiptId: receiptRow.id, filePath });
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

  const supabase = await createClient();

  // Verify both rows belong to this org
  const [receiptRes, paymentRes] = await Promise.all([
    supabase.from('receipt_uploads').select('id, ocr_status').eq('id', parsed.data.receipt_id).eq('org_id', ctx.orgId).single(),
    supabase.from('payments').select('id').eq('id', parsed.data.payment_id).eq('org_id', ctx.orgId).single(),
  ]);

  if (!receiptRes.data) return Errors.NOT_FOUND();
  if (!paymentRes.data) return Errors.NOT_FOUND();

  const { error } = await supabase
    .from('receipt_uploads')
    .update({
      payment_id: parsed.data.payment_id,
      ocr_status: 'matched',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.receipt_id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[matchReceiptToPayment] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  // NOTE: matching is metadata only — no mutation of payment.status
  log.adminAction(ctx.userId, 'match_receipt', 'receipt_upload', parsed.data.receipt_id);
  revalidatePath('/dashboard/finance/receipts');
  return ok(undefined);
}
