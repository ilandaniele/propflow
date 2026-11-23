'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { currentPeriod } from '@/lib/recurring-expenses/period';
import {
  belongsToOrg,
  deleteRecurringExpense,
  generateRecurringExpenses,
  insertRecurringExpense,
  setRecurringExpenseActive,
} from '@/lib/recurring-expenses/queries';
import {
  CreateRecurringExpenseSchema,
  DeleteRecurringExpenseSchema,
  ToggleRecurringExpenseSchema,
} from '@/lib/recurring-expenses/schemas';

const RECURRING_PATH = '/dashboard/finance/expenses/recurring';

export async function createRecurringExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-recurring-expense').success) return Errors.RATE_LIMITED();

  const parsed = CreateRecurringExpenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { property_id: propertyId, category_id: categoryId } = parsed.data;

  if (!(await belongsToOrg(ctx.orgId, { propertyId, categoryId }))) return Errors.NOT_FOUND();

  await insertRecurringExpense({
    orgId: ctx.orgId,
    propertyId: propertyId ?? null,
    categoryId: categoryId ?? null,
    amount: String(parsed.data.amount),
    description: parsed.data.description,
    dayOfMonth: parsed.data.day_of_month,
  });

  log.adminAction(ctx.userId, 'create_recurring_expense', 'recurring_expense');
  revalidatePath(RECURRING_PATH);
  return ok(undefined);
}

export async function toggleRecurringExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'toggle-recurring-expense').success) return Errors.RATE_LIMITED();

  const parsed = ToggleRecurringExpenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await setRecurringExpenseActive(ctx.orgId, parsed.data.id, parsed.data.active))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'toggle_recurring_expense', 'recurring_expense', parsed.data.id);
  revalidatePath(RECURRING_PATH);
  return ok(undefined);
}

export async function removeRecurringExpense(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'delete-recurring-expense').success) return Errors.RATE_LIMITED();

  const parsed = DeleteRecurringExpenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deleteRecurringExpense(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'delete_recurring_expense', 'recurring_expense', parsed.data.id);
  revalidatePath(RECURRING_PATH);
  return ok(undefined);
}

export async function generateMonthRecurringExpenses(_prev: ActionResult<number>): Promise<ActionResult<number>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'generate-recurring-expenses').success) return Errors.RATE_LIMITED();

  const created = await generateRecurringExpenses(ctx.orgId, currentPeriod());

  log.adminAction(ctx.userId, 'generate_recurring_expenses', 'expense');
  revalidatePath(RECURRING_PATH);
  revalidatePath('/dashboard/finance');
  return ok(created);
}
