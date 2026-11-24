'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { CashAccountSchema, CashMovementSchema } from '@/lib/schemas/cash-account';
import { addCashMovement as addMovement, createCashAccount as createAccount } from '@/lib/finance/cash-accounts';

export async function createCashAccount(
  _prev: ActionResult<{ accountId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ accountId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'cash-account');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CashAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await createAccount(ctx.orgId, parsed.data);
  if (result.status === 'duplicate') return Errors.CONFLICT('An account with this name already exists');

  log.adminAction(ctx.userId, 'create_cash_account', 'cash_account', result.accountId);
  revalidatePath('/dashboard/cash-accounts');
  return ok({ accountId: result.accountId });
}

export async function addCashMovement(
  _prev: ActionResult<{ saved: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'cash-movement');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CashMovementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await addMovement(ctx.orgId, ctx.profile.id, parsed.data);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'inactive') return err('INACTIVE', 'This account is inactive');

  log.adminAction(ctx.userId, 'add_cash_movement', 'cash_account', parsed.data.account_id);
  revalidatePath('/dashboard/cash-accounts');
  revalidatePath(`/dashboard/cash-accounts/${parsed.data.account_id}`);
  return ok({ saved: true });
}
