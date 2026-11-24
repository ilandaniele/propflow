'use server';

import { requireUser } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { PaymentReceiptSchema } from '@/lib/schemas/payment';
import { loadPaymentReceipt, type PaymentReceipt } from '@/lib/receipts/payment-receipt';

export async function getPaymentReceipt(paymentId: string): Promise<ActionResult<PaymentReceipt>> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'payment-receipt');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = PaymentReceiptSchema.safeParse({ payment_id: paymentId });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const tenantProfileId = ctx.role === 'admin' ? undefined : ctx.userId;
  const receipt = await loadPaymentReceipt(ctx.orgId, parsed.data.payment_id, tenantProfileId);
  return receipt ? ok(receipt) : Errors.NOT_FOUND();
}
