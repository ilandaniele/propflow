'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { pricingTables } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { PricingTableSchema, UpdatePricingTableSchema } from '@/lib/schemas/pricing';

export async function createPricingTable(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-pricing-table');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = PricingTableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let tiers: unknown;
  try { tiers = JSON.parse(parsed.data.tiers); } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid tiers JSON'], fieldErrors: {} });
  }

  try {
    await db.insert(pricingTables).values({
      orgId: ctx.orgId,
      name: parsed.data.name,
      propertyType: parsed.data.property_type,
      marketZone: parsed.data.market_zone,
      tiers,
    });
  } catch (err) {
    log.error('[createPricingTable] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_pricing_table', 'pricing_table');
  revalidatePath('/dashboard/pricing');
  return ok(undefined);
}

export async function updatePricingTable(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-pricing-table');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdatePricingTableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let tiers: unknown;
  try { tiers = JSON.parse(parsed.data.tiers); } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['Invalid tiers JSON'], fieldErrors: {} });
  }

  const existing = await db.select({ id: pricingTables.id })
    .from(pricingTables)
    .where(and(eq(pricingTables.id, parsed.data.id), eq(pricingTables.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);
  if (!existing) return Errors.NOT_FOUND();

  try {
    await db.update(pricingTables).set({
      name: parsed.data.name,
      propertyType: parsed.data.property_type,
      marketZone: parsed.data.market_zone,
      tiers,
      updatedAt: new Date(),
    }).where(and(eq(pricingTables.id, parsed.data.id), eq(pricingTables.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updatePricingTable] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/pricing');
  return ok(undefined);
}
