'use server';

/**
 * src/app/actions/mappings.ts
 *
 * Server Actions for the import mapping tables:
 *   phantom_rooms     — map unmatched room labels to units
 *   property_mappings — map external property names to internal properties
 *   account_mappings  — map external account codes to internal expense categories
 */

import { z } from 'zod';
import { db } from '@/lib/db';
import { phantomRooms, propertyMappings, accountMappings } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
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

export async function savePhantomRoomMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<PhantomRoomMapping>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'savePhantomRoomMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SavePhantomRoomMappingSchema.safeParse({
    label:      formData.get('label'),
    unitId:     formData.get('unitId'),
    resolution: formData.get('resolution') ?? 'mapped',
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { label, unitId, resolution } = parsed.data;
  const now = new Date();

  try {
    const rows = await db
      .insert(phantomRooms)
      .values({
        orgId:         ctx.orgId,
        rawRoomLabel:  label,
        matchedUnitId: unitId,
        resolution,
        resolvedBy:    ctx.userId,
        resolvedAt:    now,
      })
      .onConflictDoUpdate({
        target: [phantomRooms.orgId, phantomRooms.rawRoomLabel],
        set: {
          matchedUnitId: unitId,
          resolution,
          resolvedBy:    ctx.userId,
          resolvedAt:    now,
        },
      })
      .returning({ id: phantomRooms.id, rawRoomLabel: phantomRooms.rawRoomLabel, matchedUnitId: phantomRooms.matchedUnitId, resolution: phantomRooms.resolution, resolvedAt: phantomRooms.resolvedAt });

    if (!rows[0]) throw new Error('No row returned');

    return ok<PhantomRoomMapping>({
      id:            rows[0].id,
      rawRoomLabel:  rows[0].rawRoomLabel,
      matchedUnitId: rows[0].matchedUnitId,
      resolution:    rows[0].resolution,
      resolvedAt:    rows[0].resolvedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error('[savePhantomRoomMapping] upsert error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }
}

export async function listPhantomRooms(): Promise<ActionResult<PhantomRoomMapping[]>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rows = await db
    .select({ id: phantomRooms.id, rawRoomLabel: phantomRooms.rawRoomLabel, matchedUnitId: phantomRooms.matchedUnitId, resolution: phantomRooms.resolution, resolvedAt: phantomRooms.resolvedAt })
    .from(phantomRooms)
    .where(eq(phantomRooms.orgId, ctx.orgId))
    .orderBy(asc(phantomRooms.rawRoomLabel));

  return ok<PhantomRoomMapping[]>(rows.map(r => ({
    id:            r.id,
    rawRoomLabel:  r.rawRoomLabel,
    matchedUnitId: r.matchedUnitId,
    resolution:    r.resolution,
    resolvedAt:    r.resolvedAt?.toISOString() ?? null,
  })));
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

export async function savePropertyMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<PropertyMapping>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'savePropertyMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SavePropertyMappingSchema.safeParse({
    externalName:       formData.get('externalName'),
    internalPropertyId: formData.get('internalPropertyId'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { externalName, internalPropertyId } = parsed.data;
  const now = new Date();

  try {
    const rows = await db
      .insert(propertyMappings)
      .values({
        orgId:              ctx.orgId,
        externalName,
        internalPropertyId,
        lastMatchedAt:      now,
        createdBy:          ctx.userId,
      })
      .onConflictDoUpdate({
        target: [propertyMappings.orgId, propertyMappings.externalName],
        set: {
          internalPropertyId,
          lastMatchedAt: now,
        },
      })
      .returning({ id: propertyMappings.id, externalName: propertyMappings.externalName, internalPropertyId: propertyMappings.internalPropertyId, lastMatchedAt: propertyMappings.lastMatchedAt });

    if (!rows[0]) throw new Error('No row returned');

    return ok<PropertyMapping>({
      id:                 rows[0].id,
      externalName:       rows[0].externalName,
      internalPropertyId: rows[0].internalPropertyId,
      lastMatchedAt:      rows[0].lastMatchedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error('[savePropertyMapping] upsert error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }
}

export async function listPropertyMappings(): Promise<ActionResult<PropertyMapping[]>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rows = await db
    .select({ id: propertyMappings.id, externalName: propertyMappings.externalName, internalPropertyId: propertyMappings.internalPropertyId, lastMatchedAt: propertyMappings.lastMatchedAt })
    .from(propertyMappings)
    .where(eq(propertyMappings.orgId, ctx.orgId))
    .orderBy(asc(propertyMappings.externalName));

  return ok<PropertyMapping[]>(rows.map(r => ({
    id:                 r.id,
    externalName:       r.externalName,
    internalPropertyId: r.internalPropertyId,
    lastMatchedAt:      r.lastMatchedAt?.toISOString() ?? null,
  })));
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

export async function saveAccountMapping(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<AccountMapping>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'saveAccountMapping');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SaveAccountMappingSchema.safeParse({
    externalAccount:  formData.get('externalAccount'),
    internalCategory: formData.get('internalCategory') ?? undefined,
    isIncome:         formData.get('isIncome'),
    affectsNetProfit: formData.get('affectsNetProfit'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { externalAccount, internalCategory, isIncome, affectsNetProfit } = parsed.data;

  try {
    const rows = await db
      .insert(accountMappings)
      .values({
        orgId:            ctx.orgId,
        externalAccount,
        internalCategory: internalCategory ?? null,
        isIncome,
        affectsNetProfit,
        createdBy:        ctx.userId,
      })
      .onConflictDoUpdate({
        target: [accountMappings.orgId, accountMappings.externalAccount],
        set: {
          internalCategory: internalCategory ?? null,
          isIncome,
          affectsNetProfit,
        },
      })
      .returning({ id: accountMappings.id, externalAccount: accountMappings.externalAccount, internalCategory: accountMappings.internalCategory, isIncome: accountMappings.isIncome, affectsNetProfit: accountMappings.affectsNetProfit });

    if (!rows[0]) throw new Error('No row returned');

    return ok<AccountMapping>({
      id:               rows[0].id,
      externalAccount:  rows[0].externalAccount,
      internalCategory: rows[0].internalCategory,
      isIncome:         rows[0].isIncome,
      affectsNetProfit: rows[0].affectsNetProfit,
    });
  } catch (e) {
    console.error('[saveAccountMapping] upsert error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }
}

export async function listAccountMappings(): Promise<ActionResult<AccountMapping[]>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rows = await db
    .select({ id: accountMappings.id, externalAccount: accountMappings.externalAccount, internalCategory: accountMappings.internalCategory, isIncome: accountMappings.isIncome, affectsNetProfit: accountMappings.affectsNetProfit })
    .from(accountMappings)
    .where(eq(accountMappings.orgId, ctx.orgId))
    .orderBy(asc(accountMappings.externalAccount));

  return ok<AccountMapping[]>(rows.map(r => ({
    id:               r.id,
    externalAccount:  r.externalAccount,
    internalCategory: r.internalCategory,
    isIncome:         r.isIncome,
    affectsNetProfit: r.affectsNetProfit,
  })));
}
