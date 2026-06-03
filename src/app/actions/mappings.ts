'use server';

/**
 * src/app/actions/mappings.ts
 *
 * Server Actions for the import mapping tables:
 *   phantom_rooms     — map unmatched room labels to units
 *   property_mappings — map external property names to internal properties
 *   account_mappings  — map external account codes to internal expense categories
 *
 * AC30: Every action begins with requireAdmin() + Zod validation + mutationRateLimit.
 */

import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import type { ActionResult } from '@/lib/errors';

// ---------------------------------------------------------------------------
// phantom_rooms — label → unit mapping
// ---------------------------------------------------------------------------

const SavePhantomRoomMappingSchema = z.object({
  label:      z.string().min(1).max(500),
  unitId:     z.string().uuid('unitId must be a valid UUID'),
  resolution: z.enum(['mapped', 'ignored']).default('mapped'),
});

export interface PhantomRoomMapping {
  id: string;
  rawRoomLabel: string;
  matchedUnitId: string | null;
  resolution: string;
  resolvedAt: string | null;
}

/**
 * Upsert a phantom_rooms mapping.
 * If the label already exists, updates the unit mapping and resolution.
 */
export async function savePhantomRoomMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<PhantomRoomMapping>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit
  const rl = mutationRateLimit(ctx.userId, 'savePhantomRoomMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate
  const parsed = SavePhantomRoomMappingSchema.safeParse({
    label:      formData.get('label'),
    unitId:     formData.get('unitId'),
    resolution: formData.get('resolution') ?? 'mapped',
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { label, unitId, resolution } = parsed.data;

  // 4. Upsert — ON CONFLICT on (org_id, raw_room_label) update matched_unit_id
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('phantom_rooms')
    .upsert(
      {
        org_id:          ctx.orgId,
        raw_room_label:  label,
        matched_unit_id: unitId,
        resolution,
        resolved_by:     ctx.userId,
        resolved_at:     new Date().toISOString(),
      },
      { onConflict: 'org_id,raw_room_label' }
    )
    .select('id, raw_room_label, matched_unit_id, resolution, resolved_at')
    .single();

  if (error || !data) {
    console.error('[savePhantomRoomMapping] upsert error:', error?.code ?? 'no-data');
    return Errors.INTERNAL();
  }

  return ok<PhantomRoomMapping>({
    id:            data.id as string,
    rawRoomLabel:  data.raw_room_label as string,
    matchedUnitId: data.matched_unit_id as string | null,
    resolution:    data.resolution as string,
    resolvedAt:    data.resolved_at as string | null,
  });
}

/**
 * List all phantom rooms for the current org.
 */
export async function listPhantomRooms(): Promise<ActionResult<PhantomRoomMapping[]>> {
  try {
    await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('phantom_rooms')
    .select('id, raw_room_label, matched_unit_id, resolution, resolved_at')
    .order('raw_room_label', { ascending: true });

  if (error) {
    console.error('[listPhantomRooms] query error:', error.code);
    return Errors.INTERNAL();
  }

  const items = (data ?? []).map((row: {
    id: string;
    raw_room_label: string;
    matched_unit_id: string | null;
    resolution: string;
    resolved_at: string | null;
  }) => ({
    id:            row.id,
    rawRoomLabel:  row.raw_room_label,
    matchedUnitId: row.matched_unit_id,
    resolution:    row.resolution,
    resolvedAt:    row.resolved_at,
  }));

  return ok<PhantomRoomMapping[]>(items);
}

// ---------------------------------------------------------------------------
// property_mappings — external property name → internal property
// ---------------------------------------------------------------------------

const SavePropertyMappingSchema = z.object({
  externalName:       z.string().min(1).max(500),
  internalPropertyId: z.string().uuid('internalPropertyId must be a valid UUID'),
});

export interface PropertyMapping {
  id: string;
  externalName: string;
  internalPropertyId: string | null;
  lastMatchedAt: string | null;
}

/**
 * Upsert a property_mappings row.
 */
export async function savePropertyMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<PropertyMapping>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit
  const rl = mutationRateLimit(ctx.userId, 'savePropertyMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate
  const parsed = SavePropertyMappingSchema.safeParse({
    externalName:       formData.get('externalName'),
    internalPropertyId: formData.get('internalPropertyId'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { externalName, internalPropertyId } = parsed.data;

  // 4. Upsert
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('property_mappings')
    .upsert(
      {
        org_id:               ctx.orgId,
        external_name:        externalName,
        internal_property_id: internalPropertyId,
        last_matched_at:      new Date().toISOString(),
        created_by:           ctx.userId,
      },
      { onConflict: 'org_id,external_name' }
    )
    .select('id, external_name, internal_property_id, last_matched_at')
    .single();

  if (error || !data) {
    console.error('[savePropertyMapping] upsert error:', error?.code ?? 'no-data');
    return Errors.INTERNAL();
  }

  return ok<PropertyMapping>({
    id:                 data.id as string,
    externalName:       data.external_name as string,
    internalPropertyId: data.internal_property_id as string | null,
    lastMatchedAt:      data.last_matched_at as string | null,
  });
}

/**
 * List all property mappings for the current org.
 */
export async function listPropertyMappings(): Promise<ActionResult<PropertyMapping[]>> {
  try {
    await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('property_mappings')
    .select('id, external_name, internal_property_id, last_matched_at')
    .order('external_name', { ascending: true });

  if (error) {
    console.error('[listPropertyMappings] query error:', error.code);
    return Errors.INTERNAL();
  }

  const items = (data ?? []).map((row: {
    id: string;
    external_name: string;
    internal_property_id: string | null;
    last_matched_at: string | null;
  }) => ({
    id:                 row.id,
    externalName:       row.external_name,
    internalPropertyId: row.internal_property_id,
    lastMatchedAt:      row.last_matched_at,
  }));

  return ok<PropertyMapping[]>(items);
}

// ---------------------------------------------------------------------------
// account_mappings — external account code → internal category
// ---------------------------------------------------------------------------

const SaveAccountMappingSchema = z.object({
  externalAccount:   z.string().min(1).max(500),
  internalCategory:  z.string().min(1).max(255).optional(),
  isIncome:          z.preprocess(
    val => val === 'true' || val === true,
    z.boolean().default(false)
  ),
  affectsNetProfit:  z.preprocess(
    val => val === 'false' || val === false ? false : true,
    z.boolean().default(true)
  ),
});

export interface AccountMapping {
  id: string;
  externalAccount: string;
  internalCategory: string | null;
  isIncome: boolean;
  affectsNetProfit: boolean;
}

/**
 * Upsert an account_mappings row.
 */
export async function saveAccountMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<AccountMapping>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit
  const rl = mutationRateLimit(ctx.userId, 'saveAccountMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate
  const parsed = SaveAccountMappingSchema.safeParse({
    externalAccount:  formData.get('externalAccount'),
    internalCategory: formData.get('internalCategory') ?? undefined,
    isIncome:         formData.get('isIncome'),
    affectsNetProfit: formData.get('affectsNetProfit'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { externalAccount, internalCategory, isIncome, affectsNetProfit } = parsed.data;

  // 4. Upsert
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('account_mappings')
    .upsert(
      {
        org_id:            ctx.orgId,
        external_account:  externalAccount,
        internal_category: internalCategory ?? null,
        is_income:         isIncome,
        affects_net_profit: affectsNetProfit,
        created_by:        ctx.userId,
      },
      { onConflict: 'org_id,external_account' }
    )
    .select('id, external_account, internal_category, is_income, affects_net_profit')
    .single();

  if (error || !data) {
    console.error('[saveAccountMapping] upsert error:', error?.code ?? 'no-data');
    return Errors.INTERNAL();
  }

  return ok<AccountMapping>({
    id:               data.id as string,
    externalAccount:  data.external_account as string,
    internalCategory: data.internal_category as string | null,
    isIncome:         data.is_income as boolean,
    affectsNetProfit: data.affects_net_profit as boolean,
  });
}

/**
 * List all account mappings for the current org.
 */
export async function listAccountMappings(): Promise<ActionResult<AccountMapping[]>> {
  try {
    await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('account_mappings')
    .select('id, external_account, internal_category, is_income, affects_net_profit')
    .order('external_account', { ascending: true });

  if (error) {
    console.error('[listAccountMappings] query error:', error.code);
    return Errors.INTERNAL();
  }

  const items = (data ?? []).map((row: {
    id: string;
    external_account: string;
    internal_category: string | null;
    is_income: boolean;
    affects_net_profit: boolean;
  }) => ({
    id:               row.id,
    externalAccount:  row.external_account,
    internalCategory: row.internal_category,
    isIncome:         row.is_income,
    affectsNetProfit: row.affects_net_profit,
  }));

  return ok<AccountMapping[]>(items);
}
