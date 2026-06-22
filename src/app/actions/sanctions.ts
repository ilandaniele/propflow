'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { tenants, sanctions, charges, contracts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { emit } from '@/lib/events/emit';
import { ProposeSanctionSchema, ApproveSanctionSchema, RejectSanctionSchema, DisputeSanctionSchema } from '@/lib/schemas/sanction';
import type { ActionResult } from '@/lib/errors';

export async function proposeSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'propose_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ProposeSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify tenant belongs to org
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) return Errors.NOT_FOUND();

  let sanctionId: string;
  try {
    const rows = await db
      .insert(sanctions)
      .values({
        orgId: ctx.orgId,
        tenantId: parsed.data.tenant_id,
        proposedBy: ctx.userId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        reason: parsed.data.reason,
        amount: parsed.data.amount ?? null,
        status: 'proposed',
      })
      .returning({ id: sanctions.id });

    if (!rows[0]) throw new Error('No row returned');
    sanctionId = rows[0].id;
  } catch (e) {
    log.error('[proposeSanction] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  emit('sanction.proposed', {
    orgId: ctx.orgId,
    sanctionId,
    tenantId: parsed.data.tenant_id,
    kind: parsed.data.kind,
    amount: parsed.data.amount ?? null,
  }, `sanction.proposed:${sanctionId}`);

  log.adminAction(ctx.userId, 'propose_sanction', 'sanction', sanctionId);
  revalidatePath('/dashboard/sanctions');
  revalidatePath(`/dashboard/tenants/${parsed.data.tenant_id}`);
  return ok(undefined);
}

export async function approveSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'approve_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = ApproveSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Fetch the sanction
  const sanctionRows = await db
    .select({
      id: sanctions.id,
      tenantId: sanctions.tenantId,
      kind: sanctions.kind,
      amount: sanctions.amount,
      status: sanctions.status,
      linkedChargeId: sanctions.linkedChargeId,
      title: sanctions.title,
    })
    .from(sanctions)
    .where(and(eq(sanctions.id, parsed.data.id), eq(sanctions.orgId, ctx.orgId)))
    .limit(1);

  if (!sanctionRows[0]) return Errors.NOT_FOUND();
  const sanction = sanctionRows[0];

  if (sanction.status !== 'proposed') {
    return Errors.CONFLICT('Sanction is not in proposed status');
  }
  if (sanction.linkedChargeId) {
    return Errors.CONFLICT('Sanction already has a linked charge');
  }

  let chargeId: string | null = null;

  // For monetary sanctions: find active contract and create charge
  if (sanction.kind === 'monetary' && sanction.amount) {
    const contractRows = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(
        eq(contracts.tenantId, sanction.tenantId),
        eq(contracts.orgId, ctx.orgId),
        eq(contracts.status, 'active'),
      ))
      .limit(1);

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    try {
      const chargeRows = await db
        .insert(charges)
        .values({
          orgId: ctx.orgId,
          contractId: contractRows[0]?.id ?? '',
          tenantId: sanction.tenantId,
          period,
          description: sanction.title,
          amount: sanction.amount,
          dueDate: new Date().toISOString().slice(0, 10),
        })
        .returning({ id: charges.id });

      if (!chargeRows[0]) throw new Error('No charge row returned');
      chargeId = chargeRows[0].id;
    } catch (e) {
      log.error('[approveSanction] charge insert failed', { code: e instanceof Error ? e.message : String(e) });
      return Errors.INTERNAL();
    }
  }

  try {
    await db
      .update(sanctions)
      .set({
        status: 'approved',
        approvedBy: ctx.userId,
        approvedAt: new Date(),
        linkedChargeId: chargeId,
        updatedAt: new Date(),
      })
      .where(and(eq(sanctions.id, sanction.id), eq(sanctions.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[approveSanction] update failed', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  emit('sanction.approved', {
    orgId: ctx.orgId,
    sanctionId: sanction.id,
    tenantId: sanction.tenantId,
    chargeId,
  }, `sanction.approved:${sanction.id}`);

  log.adminAction(ctx.userId, 'approve_sanction', 'sanction', sanction.id);
  revalidatePath('/dashboard/sanctions');
  revalidatePath(`/dashboard/tenants/${sanction.tenantId}`);
  return ok(undefined);
}

export async function rejectSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'reject_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RejectSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  try {
    await db
      .update(sanctions)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(and(
        eq(sanctions.id, parsed.data.id),
        eq(sanctions.orgId, ctx.orgId),
        eq(sanctions.status, 'proposed'),
      ));
  } catch (e) {
    log.error('[rejectSanction] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'reject_sanction', 'sanction', parsed.data.id);
  revalidatePath('/dashboard/sanctions');
  return ok(undefined);
}

/**
 * Tenant disputes their own sanction (portal action).
 */
export async function disputeSanction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'dispute_sanction');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = DisputeSanctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Find tenant row for this profile
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows[0]) return Errors.NOT_FOUND();

  // Verify sanction belongs to this tenant and is in approved status
  const sanctionRows = await db
    .select({ id: sanctions.id, status: sanctions.status, tenantId: sanctions.tenantId })
    .from(sanctions)
    .where(and(
      eq(sanctions.id, parsed.data.id),
      eq(sanctions.tenantId, tenantRows[0].id),
      eq(sanctions.orgId, ctx.orgId),
    ))
    .limit(1);

  if (!sanctionRows[0]) return Errors.NOT_FOUND();
  if (sanctionRows[0].status !== 'approved') {
    return Errors.CONFLICT('Only approved sanctions can be disputed');
  }

  try {
    await db
      .update(sanctions)
      .set({
        status: 'disputed',
        disputeReason: parsed.data.dispute_reason,
        disputedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(sanctions.id, sanctionRows[0].id), eq(sanctions.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[disputeSanction] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  emit('sanction.disputed', {
    orgId: ctx.orgId,
    sanctionId: sanctionRows[0].id,
    tenantId: tenantRows[0].id,
  }, `sanction.disputed:${sanctionRows[0].id}`);

  revalidatePath('/portal/sanctions');
  return ok(undefined);
}
