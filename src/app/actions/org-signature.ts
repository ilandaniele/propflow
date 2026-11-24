'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { OrgSignatureSchema } from '@/lib/schemas/contractDoc';
import { isValidSignatureImage, upsertOrgSignature } from '@/lib/contracts/org-signature';

export async function saveOrgSignature(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'save-org-signature').success) return Errors.RATE_LIMITED();

  const parsed = OrgSignatureSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  if (!isValidSignatureImage(parsed.data.signature_image)) {
    return Errors.VALIDATION_ERROR({ fieldErrors: { signature_image: ['invalid'] }, formErrors: [] });
  }

  try {
    await upsertOrgSignature(ctx.orgId, parsed.data);
  } catch (e) {
    log.error('[saveOrgSignature] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'save_org_signature', 'org_signature', ctx.orgId);
  revalidatePath('/dashboard/contracts/templates');
  return ok(undefined);
}
