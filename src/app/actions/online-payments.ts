'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { env } from '@/lib/env';
import { CreatePaymentLinkSchema } from '@/lib/online-payments/schemas';
import { createOrReusePaymentLink } from '@/lib/online-payments/links';
import { getActivePaymentAdapter } from '@/lib/online-payments/provider';
import { payLinkPath } from '@/lib/online-payments/token';

export async function createPaymentLink(
  _prev: ActionResult<{ url: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'payment_link_create').success) return Errors.RATE_LIMITED();

  const parsed = CreatePaymentLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let outcome;
  try {
    outcome = await createOrReusePaymentLink(ctx.orgId, parsed.data.charge_id, getActivePaymentAdapter());
  } catch (e) {
    log.error('[createPaymentLink] failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  if (outcome.kind === 'not_found') return Errors.NOT_FOUND();
  if (outcome.kind === 'already_paid') return Errors.CONFLICT('Charge already paid online');

  log.adminAction(ctx.userId, 'create_payment_link', 'charge', parsed.data.charge_id);
  revalidatePath('/dashboard/online-payments');
  return ok({ url: `${env.NEXT_PUBLIC_SITE_URL}${payLinkPath(outcome.token)}` });
}
