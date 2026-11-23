'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { MarkNotificationReadSchema } from '@/lib/schemas/ops';
import { markInboxRead } from '@/lib/notifications/admin-inbox';

export async function markAdminNotificationsRead(formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'mark-admin-notifications-read').success) return Errors.RATE_LIMITED();

  let notificationId: string | undefined;
  if (formData.has('notification_id')) {
    const parsed = MarkNotificationReadSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
    notificationId = parsed.data.notification_id;
  }

  try {
    await markInboxRead(ctx.orgId, ctx.profile.id, notificationId);
  } catch (e) {
    log.error('[markAdminNotificationsRead] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/notifications');
  return ok(undefined);
}
