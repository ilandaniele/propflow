'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { RemoveStaffMemberSchema, StaffMemberSchema } from '@/lib/staff/schemas';
import { deleteStaffMember, insertStaffMember, propertyBelongsToOrg } from '@/lib/staff/queries';

function revalidateStaff() {
  revalidatePath('/dashboard/staff');
  revalidatePath('/portal/staff');
}

export async function addStaffMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'add-staff-member').success) return Errors.RATE_LIMITED();

  const parsed = StaffMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { property_id, full_name, position, shift, phone, document_number } = parsed.data;
  if (property_id && !(await propertyBelongsToOrg(ctx.orgId, property_id))) return Errors.NOT_FOUND();

  try {
    await insertStaffMember({
      orgId: ctx.orgId,
      propertyId: property_id ?? null,
      fullName: full_name,
      position,
      shift: shift ?? null,
      phone: phone ?? null,
      documentNumber: document_number ?? null,
    });
  } catch (e) {
    log.error('[addStaffMember] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'add_staff_member', 'building_staff');
  revalidateStaff();
  return ok(undefined);
}

export async function removeStaffMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'remove-staff-member').success) return Errors.RATE_LIMITED();

  const parsed = RemoveStaffMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deleteStaffMember(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_staff_member', 'building_staff', parsed.data.id);
  revalidateStaff();
  return ok(undefined);
}
