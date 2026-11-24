'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, handoverActs, unitInventoryItems, units } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { generatePdfRateLimit, mutationRateLimit, sendSignatureRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { uploadFile } from '@/lib/storage';
import {
  CreateHandoverActSchema,
  DeleteInventoryItemSchema,
  HandoverActIdSchema,
  InventoryItemSchema,
  SaveHandoverPdfSchema,
} from '@/lib/schemas/handover';
import { contractHeader } from '@/lib/contracts/contract-header';
import { orgSignature } from '@/lib/contracts/org-signature';
import { hasPdfSignature } from '@/lib/contracts/pdf-bytes';
import { dispatchSignatureRequest } from '@/lib/contracts/signature-dispatch';
import { findHandoverAct, handoverDocumentPath, type HandoverActSource } from '@/lib/contracts/handover';
import type { HandoverKind } from '@/lib/contracts/handover-types';

const NOT_DRAFT = 'Only draft acts can be changed';

function revalidateDetail() {
  revalidatePath('/dashboard/contracts/[id]', 'page');
}

export async function saveInventoryItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'inventory').success) return Errors.RATE_LIMITED();

  const parsed = InventoryItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { id, unit_id: unitId, notes, ...fields } = parsed.data;

  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, ctx.orgId)))
    .limit(1);
  if (!unit) return Errors.NOT_FOUND();

  const values = { ...fields, notes: notes || null, updatedAt: new Date() };
  if (id) {
    const updated = await db
      .update(unitInventoryItems)
      .set(values)
      .where(and(eq(unitInventoryItems.id, id), eq(unitInventoryItems.orgId, ctx.orgId), eq(unitInventoryItems.unitId, unitId)))
      .returning({ id: unitInventoryItems.id });
    if (updated.length === 0) return Errors.NOT_FOUND();
  } else {
    await db.insert(unitInventoryItems).values({ ...values, orgId: ctx.orgId, unitId });
  }

  log.adminAction(ctx.userId, id ? 'update_inventory_item' : 'create_inventory_item', 'unit', unitId);
  revalidateDetail();
  return ok(undefined);
}

export async function deleteInventoryItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'inventory').success) return Errors.RATE_LIMITED();

  const parsed = DeleteInventoryItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const deleted = await db
    .delete(unitInventoryItems)
    .where(and(eq(unitInventoryItems.id, parsed.data.id), eq(unitInventoryItems.orgId, ctx.orgId)))
    .returning({ id: unitInventoryItems.id });
  if (deleted.length === 0) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'delete_inventory_item', 'inventory_item', parsed.data.id);
  revalidateDetail();
  return ok(undefined);
}

export async function createHandoverAct(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ id: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'handover').success) return Errors.RATE_LIMITED();

  const parsed = CreateHandoverActSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const [contract] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contract_id), eq(contracts.orgId, ctx.orgId)))
    .limit(1);
  if (!contract) return Errors.NOT_FOUND();

  const [act] = await db
    .insert(handoverActs)
    .values({
      orgId:      ctx.orgId,
      contractId: contract.id,
      kind:       parsed.data.kind,
      items:      parsed.data.items,
      notes:      parsed.data.notes || null,
    })
    .returning({ id: handoverActs.id });

  log.adminAction(ctx.userId, 'create_handover_act', 'contract', contract.id);
  revalidateDetail();
  return ok({ id: act.id });
}

export async function getHandoverActSource(_prev: ActionResult, formData: FormData): Promise<ActionResult<HandoverActSource>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!generatePdfRateLimit(ctx.userId).success) return Errors.RATE_LIMITED();

  const parsed = HandoverActIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const act = await findHandoverAct(ctx.orgId, parsed.data.handover_act_id);
  if (!act) return Errors.NOT_FOUND();

  const [contract, landlord] = await Promise.all([contractHeader(ctx.orgId, act.contractId), orgSignature(ctx.orgId)]);
  if (!contract) return Errors.NOT_FOUND();

  return ok({
    kind:      act.kind as HandoverKind,
    items:     act.items,
    notes:     act.notes,
    createdAt: act.createdAt.toISOString(),
    contract,
    landlord,
  });
}

export async function saveHandoverActPdf(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!generatePdfRateLimit(ctx.userId).success) return Errors.RATE_LIMITED();

  const parsed = SaveHandoverPdfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const bytes = new Uint8Array(await parsed.data.file.arrayBuffer());
  if (!hasPdfSignature(bytes)) return Errors.VALIDATION_ERROR({ formErrors: ['File is not a PDF'], fieldErrors: {} });

  const act = await findHandoverAct(ctx.orgId, parsed.data.handover_act_id);
  if (!act) return Errors.NOT_FOUND();
  if (act.status !== 'draft') return Errors.CONFLICT(NOT_DRAFT);

  const path = handoverDocumentPath(ctx.orgId, act.contractId, act.id);
  try {
    await uploadFile('contracts', path, Buffer.from(bytes), 'application/pdf', false);
  } catch (e) {
    log.error('[saveHandoverActPdf] upload failed', { error: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }
  await db
    .update(handoverActs)
    .set({ documentPath: path, updatedAt: new Date() })
    .where(and(eq(handoverActs.id, act.id), eq(handoverActs.orgId, ctx.orgId)));

  log.adminAction(ctx.userId, 'generate_handover_pdf', 'handover_act', act.id);
  revalidateDetail();
  return ok(undefined);
}

export async function sendHandoverActForSignature(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!sendSignatureRateLimit(ctx.userId).success) return Errors.RATE_LIMITED();

  const parsed = HandoverActIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const act = await findHandoverAct(ctx.orgId, parsed.data.handover_act_id);
  if (!act) return Errors.NOT_FOUND();
  if (act.status !== 'draft') return Errors.CONFLICT(NOT_DRAFT);
  if (!act.documentPath) return Errors.VALIDATION_ERROR({ formErrors: ['Generate the PDF first'], fieldErrors: {} });

  const dispatched = await dispatchSignatureRequest(ctx.orgId, act.contractId, act.id);
  if ('error' in dispatched) {
    return dispatched.error === 'no_email'
      ? Errors.VALIDATION_ERROR({ formErrors: ['Tenant has no email address'], fieldErrors: {} })
      : Errors.INTERNAL();
  }

  await db
    .update(handoverActs)
    .set({ status: 'pending_signature', updatedAt: new Date() })
    .where(and(eq(handoverActs.id, act.id), eq(handoverActs.orgId, ctx.orgId)));

  log.adminAction(ctx.userId, 'send_handover_signature', 'signature_request', dispatched.id);
  revalidateDetail();
  return ok(undefined);
}
