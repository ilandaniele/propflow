'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { setRentScheduleEnabled } from '@/lib/finance/rent-schedule-settings';

const RentScheduleSchema = z.object({ enabled: z.enum(['true', 'false']).transform((v) => v === 'true') });

export async function saveRentSchedule(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'save-rent-schedule').success) return Errors.RATE_LIMITED();

  const parsed = RentScheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  await setRentScheduleEnabled(ctx.orgId, parsed.data.enabled);

  log.adminAction(ctx.userId, parsed.data.enabled ? 'enable_rent_schedule' : 'disable_rent_schedule', 'organization', ctx.orgId);
  revalidatePath('/dashboard/reminders');
  return ok(undefined);
}
