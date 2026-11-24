'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  assignUnitBedTenant,
  bedLabelTaken,
  deleteUnitBed,
  insertUnitBed,
  tenantBelongsToOrg,
  tenantHasOtherBed,
  unitBelongsToOrg,
} from '@/lib/unit-beds/queries';
import { AssignUnitBedSchema, CreateUnitBedSchema, DeleteUnitBedSchema } from '@/lib/unit-beds/schemas';

const unitPath = (unitId: string) => `/dashboard/units/${unitId}`;

export async function createUnitBed(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-unit-bed').success) return Errors.RATE_LIMITED();

  const parsed = CreateUnitBedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { unit_id: unitId, label, monthly_rent: monthlyRent } = parsed.data;

  if (!(await unitBelongsToOrg(ctx.orgId, unitId))) return Errors.NOT_FOUND();
  if (await bedLabelTaken(unitId, label)) return Errors.CONFLICT('Bed label already exists in this unit');

  await insertUnitBed(ctx.orgId, unitId, label, monthlyRent);

  log.adminAction(ctx.userId, 'create_unit_bed', 'unit_bed');
  revalidatePath(unitPath(unitId));
  return ok(undefined);
}

export async function assignUnitBed(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'assign-unit-bed').success) return Errors.RATE_LIMITED();

  const parsed = AssignUnitBedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { id, tenant_id: tenantId } = parsed.data;

  if (tenantId) {
    if (!(await tenantBelongsToOrg(ctx.orgId, tenantId))) return Errors.NOT_FOUND();
    if (await tenantHasOtherBed(tenantId, id)) return Errors.CONFLICT('Tenant already has a bed');
  }

  const unitId = await assignUnitBedTenant(ctx.orgId, id, tenantId);
  if (!unitId) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'assign_unit_bed', 'unit_bed', id);
  revalidatePath(unitPath(unitId));
  return ok(undefined);
}

export async function removeUnitBed(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'remove-unit-bed').success) return Errors.RATE_LIMITED();

  const parsed = DeleteUnitBedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const unitId = await deleteUnitBed(ctx.orgId, parsed.data.id);
  if (!unitId) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_unit_bed', 'unit_bed', parsed.data.id);
  revalidatePath(unitPath(unitId));
  return ok(undefined);
}
