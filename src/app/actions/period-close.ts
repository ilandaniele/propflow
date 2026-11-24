'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { isUniqueViolation } from '@/lib/db/errors';
import { ClosePeriodSchema, ReopenPeriodSchema } from '@/lib/period-close/schemas';
import { insertPeriodClose, removePeriodClose } from '@/lib/period-close/queries';

const CLOSING_PATH = '/dashboard/finance/closing';

export async function closePeriod(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'close-period').success) return Errors.RATE_LIMITED();

  const parsed = ClosePeriodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await insertPeriodClose({ orgId: ctx.orgId, period: parsed.data.period, closedBy: ctx.userId, note: parsed.data.note });
  } catch (e) {
    if (isUniqueViolation(e)) return Errors.CONFLICT('This period is already closed');
    log.error('[closePeriod] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'close_period', 'period_close', parsed.data.period);
  revalidatePath(CLOSING_PATH);
  return ok(undefined);
}

export async function reopenPeriod(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'reopen-period').success) return Errors.RATE_LIMITED();

  const parsed = ReopenPeriodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await removePeriodClose(ctx.orgId, parsed.data.period))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'reopen_period', 'period_close', parsed.data.period);
  revalidatePath(CLOSING_PATH);
  return ok(undefined);
}
