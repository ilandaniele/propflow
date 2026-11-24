'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { log } from '@/lib/log';
import { SetStaffRoleSchema } from '@/lib/schemas/team';
import { setStaffRole } from '@/lib/team/queries';

export async function setStaffRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'set_staff_role').success) return Errors.RATE_LIMITED();

  const parsed = SetStaffRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { profile_id, role } = parsed.data;
  if (profile_id === ctx.profile.id) return Errors.FORBIDDEN();

  const changed = await setStaffRole(ctx.orgId, profile_id, role === 'admin' ? null : role, ctx.profile.id);
  if (!changed) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'set_staff_role', 'profile', profile_id);
  revalidatePath('/dashboard/admin/team');
  return ok(undefined);
}
