'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { PropertyOwnerTermsSchema } from '@/lib/schemas/owner-settlement';
import { setPropertyOwnerTerms } from '@/lib/finance/owner-settlement-query';

export async function savePropertyOwnerTerms(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'property_owner_terms').success) return Errors.RATE_LIMITED();

  const parsed = PropertyOwnerTermsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const saved = await setPropertyOwnerTerms(ctx.orgId, {
    propertyId: parsed.data.property_id,
    ownerId: parsed.data.owner_id,
    commissionPct: parsed.data.commission_pct,
  });
  if (!saved) return Errors.NOT_FOUND();

  revalidatePath('/dashboard/finance/owner-settlements');
  return ok(undefined);
}
