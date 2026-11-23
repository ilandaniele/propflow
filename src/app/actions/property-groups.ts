'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  deletePropertyGroup,
  groupNameTaken,
  insertPropertyGroup,
  propertiesBelongToOrg,
} from '@/lib/property-groups/queries';
import { CreatePropertyGroupSchema, DeletePropertyGroupSchema } from '@/lib/property-groups/schemas';

const GROUPS_PATH = '/dashboard/properties/groups';

export async function createPropertyGroup(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-property-group').success) return Errors.RATE_LIMITED();

  const parsed = CreatePropertyGroupSchema.safeParse({
    name: formData.get('name'),
    property_ids: formData.getAll('property_ids'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { name, property_ids: propertyIds } = parsed.data;

  if (!(await propertiesBelongToOrg(ctx.orgId, propertyIds))) return Errors.NOT_FOUND();
  if (await groupNameTaken(ctx.orgId, name)) return Errors.CONFLICT('Group name already exists');

  await insertPropertyGroup(ctx.orgId, name, propertyIds);

  log.adminAction(ctx.userId, 'create_property_group', 'property_group');
  revalidatePath(GROUPS_PATH);
  return ok(undefined);
}

export async function removePropertyGroup(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'remove-property-group').success) return Errors.RATE_LIMITED();

  const parsed = DeletePropertyGroupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deletePropertyGroup(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_property_group', 'property_group', parsed.data.id);
  revalidatePath(GROUPS_PATH);
  return ok(undefined);
}
