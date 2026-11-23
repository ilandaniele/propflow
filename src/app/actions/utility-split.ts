'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, err } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { SplitUtilitySchema } from '@/lib/schemas/utility-split';
import { applyUtilitySplit } from '@/lib/finance/apply-utility-split';

export type SplitUtilityResult = ActionResult<{ created: number; skipped: number }>;

export async function splitUtilityBill(_prev: SplitUtilityResult, formData: FormData): Promise<SplitUtilityResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'split-utility-bill');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SplitUtilitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { service_payment_id, month, method, due_date } = parsed.data;
  let outcome;
  try {
    outcome = await applyUtilitySplit({ orgId: ctx.orgId, servicePaymentId: service_payment_id, month, method, dueDate: due_date });
  } catch (e) {
    log.error('[splitUtilityBill] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  if (outcome.status === 'not_found') return Errors.NOT_FOUND();
  if (outcome.status === 'no_amount') return err('NO_AMOUNT', 'No amount recorded for that month');

  log.adminAction(ctx.userId, 'split_utility_bill', 'service_payment');
  revalidatePath('/dashboard/finance/utilities');
  revalidatePath('/dashboard/payments');
  return ok({ created: outcome.created, skipped: outcome.skipped });
}
