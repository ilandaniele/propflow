'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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

  const supabase = await createClient();
  const { error } = await supabase.from('pricing_tables').insert({
    org_id: ctx.orgId,
    name: parsed.data.name,
    property_type: parsed.data.property_type,
    market_zone: parsed.data.market_zone,
    tiers,
  });

  if (error) {
    log.error('[createPricingTable] db error', { code: error.code });
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

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('pricing_tables').select('id').eq('id', parsed.data.id).eq('org_id', ctx.orgId).single();
  if (!existing) return Errors.NOT_FOUND();

  const { error } = await supabase.from('pricing_tables').update({
    name: parsed.data.name,
    property_type: parsed.data.property_type,
    market_zone: parsed.data.market_zone,
    tiers,
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.id).eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updatePricingTable] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/pricing');
  return ok(undefined);
}
