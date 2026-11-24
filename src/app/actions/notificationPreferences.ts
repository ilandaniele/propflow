'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { saveEmailPreferences } from '@/lib/notifications/preferences';
import { EmailPreferencesFormSchema } from '@/lib/schemas/notificationPreferences';
import type { ActionResult } from '@/lib/errors';

/** Saves the signed-in tenant's own email preferences; ids come from the session only. */
export async function updateEmailPreferences(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-email-preferences');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = EmailPreferencesFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await saveEmailPreferences(ctx.orgId, ctx.userId, parsed.data);
  } catch (e) {
    log.error('[updateEmailPreferences] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/portal/profile');
  return ok(undefined);
}
