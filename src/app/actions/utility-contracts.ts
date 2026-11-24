'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, type AuthContext } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  deleteContract,
  findContract,
  insertContract,
  recordHolderChange,
  scopeBelongsToOrg,
  updateContract,
} from '@/lib/utility-contracts/queries';
import {
  ChangeUtilityHolderSchema,
  CreateUtilityContractSchema,
  DeleteUtilityContractSchema,
  UpdateUtilityContractSchema,
} from '@/lib/utility-contracts/schemas';

const propertyPath = (propertyId: string) => `/dashboard/properties/${propertyId}`;

async function authorize(action: string): Promise<AuthContext | ActionResult> {
  let ctx: AuthContext;
  try {
    ctx = await requireAdmin();
  } catch (error) {
    return error instanceof Error && error.message === 'FORBIDDEN' ? Errors.FORBIDDEN() : Errors.UNAUTHORIZED();
  }
  if (!mutationRateLimit(ctx.userId, action).success) return Errors.RATE_LIMITED();
  return ctx;
}

const isContext = (value: AuthContext | ActionResult): value is AuthContext => 'orgId' in value;

export async function createUtilityContract(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await authorize('create-utility-contract');
  if (!isContext(ctx)) return ctx;

  const parsed = CreateUtilityContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { property_id: propertyId, ...input } = parsed.data;

  if (!(await scopeBelongsToOrg(ctx.orgId, propertyId, input.unit_id))) return Errors.NOT_FOUND();
  await insertContract(ctx.orgId, propertyId, input);

  log.adminAction(ctx.userId, 'create_utility_contract', 'utility_contract');
  revalidatePath(propertyPath(propertyId));
  return ok(undefined);
}

export async function editUtilityContract(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await authorize('edit-utility-contract');
  if (!isContext(ctx)) return ctx;

  const parsed = UpdateUtilityContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const contract = await findContract(ctx.orgId, parsed.data.id);
  if (!contract) return Errors.NOT_FOUND();
  if (!(await scopeBelongsToOrg(ctx.orgId, contract.propertyId, parsed.data.unit_id))) return Errors.NOT_FOUND();
  await updateContract(ctx.orgId, parsed.data);

  log.adminAction(ctx.userId, 'edit_utility_contract', 'utility_contract', parsed.data.id);
  revalidatePath(propertyPath(contract.propertyId));
  return ok(undefined);
}

export async function changeUtilityHolder(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await authorize('change-utility-holder');
  if (!isContext(ctx)) return ctx;

  const parsed = ChangeUtilityHolderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { id, holder_kind: holderKind, holder_name: holderName, changed_on: changedOn, reason } = parsed.data;

  const contract = await findContract(ctx.orgId, id);
  if (!contract) return Errors.NOT_FOUND();
  await recordHolderChange(ctx.orgId, { id, fromHolder: contract.holderName, holderKind, holderName, changedOn, reason });

  log.adminAction(ctx.userId, 'change_utility_holder', 'utility_contract', id);
  revalidatePath(propertyPath(contract.propertyId));
  return ok(undefined);
}

export async function removeUtilityContract(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await authorize('remove-utility-contract');
  if (!isContext(ctx)) return ctx;

  const parsed = DeleteUtilityContractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const propertyId = await deleteContract(ctx.orgId, parsed.data.id);
  if (!propertyId) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_utility_contract', 'utility_contract', parsed.data.id);
  revalidatePath(propertyPath(propertyId));
  return ok(undefined);
}
