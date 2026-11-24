'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { DepositMovementSchema } from '@/lib/schemas/deposit';
import { recordDepositMovement } from '@/lib/finance/deposit';

export async function saveDepositMovement(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'deposit-movement');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = DepositMovementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { contract_id: contractId, moved_on: movedOn, ...rest } = parsed.data;
  const result = await recordDepositMovement({ orgId: ctx.orgId, contractId, movedOn, createdBy: ctx.profile.id, ...rest });
  if (result === 'not_found') return Errors.NOT_FOUND();
  if (result === 'exceeds_balance') return err('EXCEEDS_BALANCE', 'Amount exceeds the deposit held');

  log.adminAction(ctx.userId, `deposit_${rest.kind}`, 'deposit_movement');
  revalidatePath('/dashboard/deposits');
  revalidatePath(`/dashboard/deposits/${contractId}`);
  return ok(undefined);
}
