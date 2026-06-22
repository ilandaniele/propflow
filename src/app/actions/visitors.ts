'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { visitorLogs, contracts, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { VisitorLogSchema, UpdateVisitorLogSchema } from '@/lib/schemas/community';

export async function createVisitorLog(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-visitor-log');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = VisitorLogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // For tenant callers: validate that the unit belongs to their active contract (IC-E3)
  let unitId = parsed.data.unit_id ?? null;
  if (ctx.role === 'tenant') {
    // Derive unit from tenant's active contract
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
      .limit(1);

    const tenantIds = tenantRows.map(t => t.id);

    let tenantUnitId: string | null = null;
    if (tenantIds.length > 0) {
      const contractRows = await db
        .select({ unitId: contracts.unitId })
        .from(contracts)
        .where(and(
          eq(contracts.tenantId, tenantIds[0]),
          eq(contracts.orgId, ctx.orgId),
          eq(contracts.status, 'active'),
        ))
        .limit(1);
      tenantUnitId = contractRows[0]?.unitId ?? null;
    }

    if (!tenantUnitId) return Errors.FORBIDDEN();

    if (unitId && unitId !== tenantUnitId) return Errors.FORBIDDEN();
    unitId = tenantUnitId;
  }

  try {
    await db.insert(visitorLogs).values({
      orgId: ctx.orgId,
      propertyId: parsed.data.property_id ?? null,
      unitId,
      visitorName: parsed.data.visitor_name,
      hostTenantId: parsed.data.host_tenant_id ?? null,
      visitDate: parsed.data.visit_date,
      entryTime: parsed.data.entry_time ? new Date(parsed.data.entry_time) : null,
      purpose: parsed.data.purpose ?? null,
      createdBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    });
  } catch (e) {
    log.error('[createVisitorLog] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/visitors');
  revalidatePath('/portal/visitors/new');
  return ok(undefined);
}

export async function updateVisitorLog(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'update-visitor-log');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateVisitorLogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const existing = await db
    .select({ id: visitorLogs.id })
    .from(visitorLogs)
    .where(and(eq(visitorLogs.id, parsed.data.id), eq(visitorLogs.orgId, ctx.orgId)))
    .limit(1);

  if (!existing[0]) return Errors.NOT_FOUND();

  const { id, ...updates } = parsed.data;

  try {
    await db
      .update(visitorLogs)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(visitorLogs.id, id), eq(visitorLogs.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateVisitorLog] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/visitors');
  return ok(undefined);
}
