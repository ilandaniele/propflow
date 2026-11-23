'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { RentAdjustmentSchema } from '@/lib/schemas/rent-adjustment';
import { applyRentAdjustment } from '@/lib/finance/rent-adjustment';

export async function adjustRent(
  _prev: ActionResult<{ newRent: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ newRent: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'rent-adjustment');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RentAdjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await applyRentAdjustment({
    orgId: ctx.orgId,
    contractId: parsed.data.contract_id,
    percent: parsed.data.percent,
    effectiveOn: parsed.data.effective_on,
    createdBy: ctx.profile.id,
  });
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'not_active') return err('NOT_ACTIVE', 'Only active contracts can be adjusted');

  log.adminAction(ctx.userId, 'adjust_rent', 'contract', parsed.data.contract_id);
  revalidatePath('/dashboard/rent-adjustments');
  revalidatePath('/dashboard/contracts');
  return ok({ newRent: result.newRent });
}
