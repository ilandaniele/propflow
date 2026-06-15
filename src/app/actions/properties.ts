'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { properties, units } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreatePropertySchema, UpdatePropertySchema, CreateUnitSchema, UpdateUnitSchema } from '@/lib/schemas/property';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

export async function createProperty(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreatePropertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db.insert(properties).values({
      ...parsed.data,
      orgId: ctx.orgId,
    });
  } catch (err) {
    log.error('[createProperty] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_property', 'property');
  revalidatePath('/dashboard/properties');
  return ok(undefined);
}

export async function updateProperty(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdatePropertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;

  try {
    await db
      .update(properties)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(properties.id, id), eq(properties.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateProperty] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_property', 'property', id);
  revalidatePath('/dashboard/properties');
  return ok(undefined);
}

export async function createUnit(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { property_id, floor, ...rest } = parsed.data;
  try {
    await db.insert(units).values({
      ...rest,
      propertyId: property_id,
      orgId: ctx.orgId,
      floor: floor || null,
    });
  } catch (err) {
    log.error('[createUnit] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_unit', 'unit');
  revalidatePath('/dashboard/units');
  return ok(undefined);
}

export async function updateUnit(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...updates } = parsed.data;

  try {
    await db
      .update(units)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(units.id, id), eq(units.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateUnit] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_unit', 'unit', id);
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
