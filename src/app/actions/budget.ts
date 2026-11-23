'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { ExpenseBudgetSchema } from '@/lib/schemas/budget';
import { setExpenseBudget as saveBudget } from '@/lib/finance/budget';

export async function setExpenseBudget(
  _prev: ActionResult<{ saved: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'expense-budget');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ExpenseBudgetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await saveBudget(ctx.orgId, parsed.data);
  if (result.status === 'not_found') return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'set_expense_budget', 'expense_category', parsed.data.category_id);
  revalidatePath('/dashboard/budget');
  return ok({ saved: true });
}
