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
  } catch (e) {
    log.error('[createProperty] db error', { code: e instanceof Error ? e.message : String(e) });
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
  } catch (e) {
    log.error('[updateProperty] db error', { code: e instanceof Error ? e.message : String(e) });
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

  try {
    await db.insert(units).values({
      orgId: ctx.orgId,
      propertyId: parsed.data.property_id,
      label: parsed.data.label,
      floor: parsed.data.floor || null,
      bedrooms: parsed.data.bedrooms,
      toiletType: parsed.data.toilet_type,
      monthlyRentDefault: parsed.data.monthly_rent_default != null ? String(parsed.data.monthly_rent_default) : null,
    });
  } catch (e) {
    log.error('[createUnit] db error', { code: e instanceof Error ? e.message : String(e) });
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
      .set({
        label: updates.label,
        floor: updates.floor ?? undefined,
        bedrooms: updates.bedrooms,
        toiletType: updates.toilet_type,
        monthlyRentDefault: updates.monthly_rent_default != null ? String(updates.monthly_rent_default) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(units.id, id), eq(units.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateUnit] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_unit', 'unit', id);
  revalidatePath('/dashboard/units');
  return ok(undefined);
}
