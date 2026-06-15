'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { contracts, tenants, units } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import { CreateContractSchema, UpdateContractStatusSchema } from '@/lib/schemas/contract';
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
  const [tenantRow, unitRow] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.id, parsed.data.tenant_id), eq(tenants.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
    db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId)))
      .then(r => r[0] ?? null),
  ]);

  if (!tenantRow || !unitRow) return Errors.NOT_FOUND();

  try {
    await db.insert(contracts).values({
      tenantId: parsed.data.tenant_id as string,
      unitId: parsed.data.unit_id as string,
      orgId: ctx.orgId as string,
      startDate: parsed.data.start_date as string,
      endDate: (parsed.data.end_date ?? null) as string | null,
      monthlyRent: String(parsed.data.monthly_rent),
      deposit: parsed.data.deposit ? String(parsed.data.deposit) : null,
      status: 'active' as string,
    });
  } catch (err) {
    log.error('[createContract] db error', { err: err instanceof Error ? err.message : String(err) });
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
  const existing = await db.select({ id: contracts.id, status: contracts.status })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.id), eq(contracts.orgId, ctx.orgId)))
    .then(r => r[0] ?? null);

  if (!existing) return Errors.NOT_FOUND();

  try {
    await db
      .update(contracts)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(contracts.id, parsed.data.id), eq(contracts.orgId, ctx.orgId)));
  } catch (err) {
    log.error('[updateContractStatus] db error', { err: err instanceof Error ? err.message : String(err) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'update_contract_status', 'contract', parsed.data.id);
  revalidatePath('/dashboard/contracts');
  return ok(undefined);
}
