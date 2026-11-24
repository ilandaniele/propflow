'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  countEntityDefinitions,
  definitionKeyTaken,
  deleteDefinition,
  entityBelongsToOrg,
  findDefinition,
  insertDefinition,
  listEntityDefinitions,
  saveEntityFieldValues,
  updateDefinition,
} from '@/lib/custom-fields/queries';
import {
  CreateDefinitionSchema,
  DeleteDefinitionSchema,
  EntityRefSchema,
  MAX_DEFINITIONS_PER_ENTITY,
  UpdateDefinitionSchema,
  parseFieldValues,
  type CustomFieldType,
} from '@/lib/custom-fields/schemas';
import { entityDetailPath } from '@/lib/custom-fields/paths';

const ADMIN_PATH = '/dashboard/admin/custom-fields';

function storedOptions(fieldType: CustomFieldType, options: string[] | undefined): string[] | null {
  return fieldType === 'select' ? options ?? [] : null;
}

export async function createCustomFieldDefinition(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-custom-field').success) return Errors.RATE_LIMITED();

  const parsed = CreateDefinitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const d = parsed.data;

  if (await countEntityDefinitions(ctx.orgId, d.entity_type) >= MAX_DEFINITIONS_PER_ENTITY) {
    return Errors.CONFLICT('Custom field limit reached');
  }
  if (await definitionKeyTaken(ctx.orgId, d.entity_type, d.key)) return Errors.CONFLICT('Key already exists');

  await insertDefinition(ctx.orgId, {
    entityType: d.entity_type,
    key: d.key,
    label: d.label,
    fieldType: d.field_type,
    options: storedOptions(d.field_type, d.options),
    required: d.required,
    sortOrder: d.sort_order,
  });

  log.adminAction(ctx.userId, 'create_custom_field', 'custom_field_definition');
  revalidatePath(ADMIN_PATH);
  return ok(undefined);
}

export async function updateCustomFieldDefinition(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'update-custom-field').success) return Errors.RATE_LIMITED();

  const parsed = UpdateDefinitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const d = parsed.data;

  const existing = await findDefinition(ctx.orgId, d.id);
  if (!existing) return Errors.NOT_FOUND();
  const options = storedOptions(existing.fieldType, d.options);
  if (existing.fieldType === 'select' && options?.length === 0) {
    return Errors.VALIDATION_ERROR({ fieldErrors: { options: ['Select fields need at least one option'] } });
  }

  await updateDefinition(ctx.orgId, d.id, { label: d.label, required: d.required, sortOrder: d.sort_order, options });

  log.adminAction(ctx.userId, 'update_custom_field', 'custom_field_definition', d.id);
  revalidatePath(ADMIN_PATH);
  return ok(undefined);
}

export async function removeCustomFieldDefinition(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'remove-custom-field').success) return Errors.RATE_LIMITED();

  const parsed = DeleteDefinitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deleteDefinition(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_custom_field', 'custom_field_definition', parsed.data.id);
  revalidatePath(ADMIN_PATH);
  return ok(undefined);
}

export async function saveCustomFieldValues(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'save-custom-field-values').success) return Errors.RATE_LIMITED();

  const ref = EntityRefSchema.safeParse({ entity_type: formData.get('entity_type'), entity_id: formData.get('entity_id') });
  if (!ref.success) return Errors.VALIDATION_ERROR(ref.error.flatten());
  const { entity_type: entityType, entity_id: entityId } = ref.data;

  const [owned, definitions] = await Promise.all([
    entityBelongsToOrg(ctx.orgId, entityType, entityId),
    listEntityDefinitions(ctx.orgId, entityType),
  ]);
  if (!owned) return Errors.NOT_FOUND();

  const parsed = parseFieldValues(definitions, formData);
  if (!parsed.ok) return Errors.VALIDATION_ERROR({ fieldErrors: parsed.fieldErrors });

  await saveEntityFieldValues(ctx.orgId, entityId, parsed.values);

  log.adminAction(ctx.userId, 'save_custom_field_values', entityType, entityId);
  revalidatePath(entityDetailPath(entityType, entityId));
  return ok(undefined);
}
