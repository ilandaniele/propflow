'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { contracts, tenants, units } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, err, ok } from '@/lib/errors';
import { CreateContractSchema, RenewContractSchema, UpdateContractStatusSchema } from '@/lib/schemas/contract';
import { renewContract as renewContractRecord } from '@/lib/contracts/renewal';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';

export async function createContract(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = CreateContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify tenant and unit belong to this org
  const [tenantRows, unitRows] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId))).limit(1),
    db.select({ id: units.id }).from(units).where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId))).limit(1),
  ]);

  if (!tenantRows[0] || !unitRows[0]) return Errors.NOT_FOUND();

  try {
    await db.insert(contracts).values({
      tenantId: parsed.data.tenant_id,
      unitId: parsed.data.unit_id,
      startDate: parsed.data.start_date,
      endDate: parsed.data.end_date ?? null,
      monthlyRent: String(parsed.data.monthly_rent),
      deposit: parsed.data.deposit != null ? String(parsed.data.deposit) : null,
      orgId: ctx.orgId,
      status: 'active',
    });
  } catch (e) {
    log.error('[createContract] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'create_contract', 'contract');
  revalidatePath('/dashboard/contracts');
  return ok(undefined);
}

export async function updateContractStatus(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = UpdateContractStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // Verify contract belongs to this org
  const existing = await db
    .select({ id: contracts.id, status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);

  if (!existing[0]) return Errors.NOT_FOUND();

  try {
    await db
      .update(contracts)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(contracts.id, parsed.data.id), eq(contracts.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateContractStatus] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_contract_status', 'contract', parsed.data.id);
  revalidatePath('/dashboard/contracts');
  return ok(undefined);
}

export async function renewContract(
  _prev: ActionResult<{ contractId: string }> | null,
  formData: FormData
): Promise<ActionResult<{ contractId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'contract-renewal');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = RenewContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await renewContractRecord({
    orgId: ctx.orgId,
    contractId: parsed.data.contract_id,
    months: parsed.data.months,
    monthlyRent: parsed.data.monthly_rent,
    today: new Date().toISOString().slice(0, 10),
  });
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'not_active') return err('NOT_ACTIVE', 'Only active contracts can be renewed');

  log.adminAction(ctx.userId, 'renew_contract', 'contract', result.contractId);
  revalidatePath('/dashboard/contracts');
  return ok({ contractId: result.contractId });
}
