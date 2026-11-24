'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { visitorLogs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { AuthContext } from '@/lib/auth/guards';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import { VisitorLogSchema, UpdateVisitorLogSchema } from '@/lib/schemas/community';
import { AuthorizedVisitorSchema, RemoveAuthorizedVisitorSchema } from '@/lib/visitors/schemas';
import {
  deleteAuthorizedVisitor,
  findTenantActiveUnit,
  insertAuthorizedVisitor,
  unitBelongsToOrg,
} from '@/lib/visitors/queries';

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
  let hostTenantId = parsed.data.host_tenant_id ?? null;
  if (ctx.role === 'tenant') {
    const tenantUnit = await findTenantActiveUnit(ctx.orgId, ctx.userId);
    if (!tenantUnit) return Errors.FORBIDDEN();
    if (unitId && unitId !== tenantUnit.unitId) return Errors.FORBIDDEN();
    unitId = tenantUnit.unitId;
    // A tenant may only log visitors they themselves host — never impersonate
    // another tenant via a client-supplied host_tenant_id.
    hostTenantId = tenantUnit.tenantId;
  }

  try {
    await db.insert(visitorLogs).values({
      orgId: ctx.orgId,
      propertyId: parsed.data.property_id ?? null,
      unitId,
      visitorName: parsed.data.visitor_name,
      hostTenantId,
      visitDate: parsed.data.visit_date,
      entryTime: parsed.data.entry_time ? new Date(parsed.data.entry_time) : null,
      purpose: parsed.data.purpose ?? null,
      passphrase: parsed.data.passphrase ?? null,
      createdBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    });
  } catch (e) {
    log.error('[createVisitorLog] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  revalidatePath('/dashboard/visitors');
  revalidatePath('/portal/visitors');
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

const AUTHORIZED_PATHS = ['/dashboard/visitors', '/portal/visitors'];

async function resolveScopedUnit(ctx: AuthContext, requestedUnitId: string | undefined) {
  if (ctx.role === 'tenant') {
    const tenantUnit = await findTenantActiveUnit(ctx.orgId, ctx.userId);
    return tenantUnit?.unitId ?? null;
  }
  if (!requestedUnitId) return null;
  return (await unitBelongsToOrg(ctx.orgId, requestedUnitId)) ? requestedUnitId : null;
}

export async function addAuthorizedVisitor(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'add-authorized-visitor').success) return Errors.RATE_LIMITED();

  const parsed = AuthorizedVisitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const unitId = await resolveScopedUnit(ctx, parsed.data.unit_id);
  if (!unitId) return Errors.FORBIDDEN();

  try {
    await insertAuthorizedVisitor({
      orgId: ctx.orgId,
      unitId,
      fullName: parsed.data.full_name,
      documentNumber: parsed.data.document_number ?? null,
      relationship: parsed.data.relationship ?? null,
      createdBy: ctx.userId,
    });
  } catch (e) {
    log.error('[addAuthorizedVisitor] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  AUTHORIZED_PATHS.forEach((path) => revalidatePath(path));
  return ok(undefined);
}

export async function removeAuthorizedVisitor(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  if (!mutationRateLimit(ctx.userId, 'remove-authorized-visitor').success) return Errors.RATE_LIMITED();

  const parsed = RemoveAuthorizedVisitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  let scopedUnitId: string | undefined;
  if (ctx.role === 'tenant') {
    const tenantUnit = await findTenantActiveUnit(ctx.orgId, ctx.userId);
    if (!tenantUnit) return Errors.FORBIDDEN();
    scopedUnitId = tenantUnit.unitId;
  }

  const removed = await deleteAuthorizedVisitor(ctx.orgId, parsed.data.id, scopedUnitId);
  if (!removed) return Errors.NOT_FOUND();

  AUTHORIZED_PATHS.forEach((path) => revalidatePath(path));
  return ok(undefined);
}
