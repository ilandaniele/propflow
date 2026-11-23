'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { toE164 } from '@/lib/whatsapp/phone';
import { requestLinkCode, unlinkProfile } from '@/lib/owner-assistant/links';

const PAGE = '/dashboard/admin/whatsapp-assistant';
const PhoneSchema = z.object({
  phone: z.string().trim().max(32).transform(toE164).pipe(z.string().regex(/^\+\d{8,15}$/)),
});

export async function requestOwnerLinkCode(
  _prev: ActionResult<{ code: string; expiresAt: string }> | null,
  formData: FormData
): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'owner_assistant_link').success) return Errors.RATE_LIMITED();

  const parsed = PhoneSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const link = await requestLinkCode(ctx.orgId, ctx.profile.id, parsed.data.phone);
  if (!link) return Errors.CONFLICT('Phone already linked to another admin');

  log.adminAction(ctx.userId, 'owner_assistant_link_code', 'profile', ctx.profile.id);
  revalidatePath(PAGE);
  return ok({ code: link.code, expiresAt: link.expiresAt.toISOString() });
}

export async function unlinkOwnerAssistant(): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'owner_assistant_unlink').success) return Errors.RATE_LIMITED();

  await unlinkProfile(ctx.orgId, ctx.profile.id);
  log.adminAction(ctx.userId, 'owner_assistant_unlink', 'profile', ctx.profile.id);
  revalidatePath(PAGE);
  return ok(undefined);
}
