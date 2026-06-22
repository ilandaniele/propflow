'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { LOCALE_COOKIE } from '@/i18n/config';
import { z } from 'zod';
import type { ActionResult } from '@/lib/errors';

const LanguageSchema = z.object({
  language: z.enum(['es', 'en', 'pt']),
});

/**
 * Update the current user's preferred_language.
 * Sets both the DB column and the locale cookie.
 * Available to any authenticated user (admin or tenant).
 */
export async function updateMyPreferredLanguage(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update_language');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = LanguageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { language } = parsed.data;

  try {
    await db
      .update(profiles)
      .set({ preferredLanguage: language })
      .where(eq(profiles.id, ctx.userId));
  } catch (e) {
    log.error('[updateMyPreferredLanguage] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  // Set locale cookie so next-intl picks it up immediately
  const store = await cookies();
  store.set(LOCALE_COOKIE, language, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  });

  log.info('[updateMyPreferredLanguage] language updated', { userId: ctx.userId });

  if (ctx.role === 'admin') revalidatePath('/dashboard');
  else revalidatePath('/portal');

  return ok(undefined);
}
