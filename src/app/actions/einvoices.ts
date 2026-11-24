'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { EmitEinvoiceSchema } from '@/lib/schemas/einvoice';
import { emitEinvoice } from '@/lib/einvoice/emit';

export async function emitEinvoiceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'einvoice_emit').success) return Errors.RATE_LIMITED();

  const parsed = EmitEinvoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let outcome;
  try {
    outcome = await emitEinvoice(ctx.orgId, parsed.data);
  } catch (e) {
    log.error('[emitEinvoiceAction] failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  if (outcome.kind === 'not_found') return Errors.NOT_FOUND();
  if (outcome.kind === 'already_emitted') return Errors.CONFLICT('Charge already has an electronic document');
  if (outcome.kind === 'invalid_customer') {
    return err('VALIDATION_ERROR', 'Invalid customer document', { reason: outcome.reason });
  }

  log.adminAction(ctx.userId, 'emit_einvoice', 'einvoice', outcome.id);
  revalidatePath('/dashboard/einvoices');
  return ok(undefined);
}
