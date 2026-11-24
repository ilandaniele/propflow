'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  assignSupplier as saveAssignment,
  createSupplier as insertSupplier,
  setSupplierActive as saveActive,
  updateAssignment as saveAssignmentUpdate,
  updateSupplier as saveSupplier,
} from '@/lib/suppliers/suppliers';
import {
  AssignSupplierSchema,
  SetSupplierActiveSchema,
  SupplierSchema,
  UpdateAssignmentSchema,
  UpdateSupplierSchema,
} from '@/lib/schemas/suppliers';

const SUPPLIERS_PATH = '/dashboard/suppliers';

type AdminContext =
  | { ctx: Awaited<ReturnType<typeof requireAdmin>>; error?: undefined }
  | { ctx?: undefined; error: ActionResult<never> };

async function adminContext(key: string): Promise<AdminContext> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return { error: Errors.UNAUTHORIZED() }; }
  if (!mutationRateLimit(ctx.userId, key).success) return { error: Errors.RATE_LIMITED() };
  return { ctx };
}

export async function createSupplier(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('create-supplier');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = SupplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const id = await insertSupplier(ctx.orgId, parsed.data);
  log.adminAction(ctx.userId, 'create_supplier', 'supplier', id);
  revalidatePath(SUPPLIERS_PATH);
  return ok(undefined);
}

export async function updateSupplier(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('update-supplier');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = UpdateSupplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { id, ...input } = parsed.data;
  if (!(await saveSupplier(ctx.orgId, id, input))) return Errors.NOT_FOUND();
  log.adminAction(ctx.userId, 'update_supplier', 'supplier', id);
  revalidatePath(SUPPLIERS_PATH);
  return ok(undefined);
}

export async function setSupplierActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('set-supplier-active');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = SetSupplierActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await saveActive(ctx.orgId, parsed.data.id, parsed.data.active))) return Errors.NOT_FOUND();
  log.adminAction(ctx.userId, parsed.data.active ? 'activate_supplier' : 'deactivate_supplier', 'supplier', parsed.data.id);
  revalidatePath(SUPPLIERS_PATH);
  return ok(undefined);
}

export async function assignSupplierToIncident(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('assign-supplier');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = AssignSupplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { incident_id: incidentId, supplier_id: supplierId } = parsed.data;
  if (!(await saveAssignment(ctx.orgId, ctx.userId, incidentId, supplierId))) return Errors.NOT_FOUND();
  log.adminAction(ctx.userId, 'assign_supplier', 'incident', incidentId);
  revalidatePath(`/dashboard/incidents/${incidentId}`);
  revalidatePath(SUPPLIERS_PATH);
  return ok(undefined);
}

export async function updateSupplierAssignment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await adminContext('update-supplier-assignment');
  if (auth.error) return auth.error;
  const { ctx } = auth;

  const parsed = UpdateAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await saveAssignmentUpdate(ctx.orgId, parsed.data))) return Errors.NOT_FOUND();
  log.adminAction(ctx.userId, 'update_supplier_assignment', 'incident', parsed.data.incident_id);
  revalidatePath(`/dashboard/incidents/${parsed.data.incident_id}`);
  revalidatePath(SUPPLIERS_PATH);
  return ok(undefined);
}
