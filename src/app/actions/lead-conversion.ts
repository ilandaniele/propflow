'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { ConvertLeadSchema } from '@/lib/schemas/lead-conversion';
import { convertLead } from '@/lib/leads/conversion';

const ALREADY_CONVERTED = 'Lead already converted';

export async function convertLeadToTenant(
  _prev: ActionResult<{ tenantId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ tenantId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'lead_convert').success) return Errors.RATE_LIMITED();

  const parsed = ConvertLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let outcome;
  try {
    outcome = await convertLead(ctx.orgId, parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('lead_conversions')) return Errors.CONFLICT(ALREADY_CONVERTED);
    log.error('[convertLeadToTenant] db error', { code: message });
    return Errors.INTERNAL();
  }

  if (outcome.kind === 'not_found') return Errors.NOT_FOUND();
  if (outcome.kind === 'already_converted') return Errors.CONFLICT(ALREADY_CONVERTED);

  log.adminAction(ctx.userId, 'convert_lead', 'tenant', outcome.tenantId);
  revalidatePath('/dashboard/leads');
  revalidatePath('/dashboard/tenants');
  revalidatePath('/dashboard/contracts');
  revalidatePath('/dashboard/units');
  return ok({ tenantId: outcome.tenantId });
}
