import { z } from 'zod';

export const CUSTOM_FIELD_ENTITY_TYPES = ['property', 'unit', 'tenant', 'contract'] as const;
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select'] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const MAX_DEFINITIONS_PER_ENTITY = 50;
const MAX_TEXT_LENGTH = 500;
const MAX_OPTIONS = 50;

export type CustomFieldDefinitionShape = {
  id: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[] | null;
};

const checkbox = z.preprocess((v) => v === 'on' || v === 'true', z.boolean());

const optionList = z
  .string()
  .max(4000)
  .transform((raw) => [...new Set(raw.split('\n').map((line) => line.trim()).filter(Boolean))])
  .pipe(z.array(z.string().max(60)).max(MAX_OPTIONS));

const editableDefinitionFields = {
  label: z.string().trim().min(1).max(80),
  required: checkbox,
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  options: optionList.optional(),
};

export const CreateDefinitionSchema = z
  .object({
    entity_type: z.enum(CUSTOM_FIELD_ENTITY_TYPES),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
    field_type: z.enum(CUSTOM_FIELD_TYPES),
    ...editableDefinitionFields,
  })
  .refine((d) => d.field_type !== 'select' || (d.options?.length ?? 0) > 0, {
    path: ['options'],
    message: 'Select fields need at least one option',
  });

export const UpdateDefinitionSchema = z.object({
  id: z.string().guid(),
  ...editableDefinitionFields,
});

export const DeleteDefinitionSchema = z.object({ id: z.string().guid() });

export const EntityRefSchema = z.object({
  entity_type: z.enum(CUSTOM_FIELD_ENTITY_TYPES),
  entity_id: z.string().guid(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}, 'Invalid date');

const finiteNumber = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,6})?$/)
  .transform((s) => String(Number(s)));

function valueSchema(definition: CustomFieldDefinitionShape): z.ZodType<string> {
  switch (definition.fieldType) {
    case 'text': return z.string().max(MAX_TEXT_LENGTH);
    case 'number': return finiteNumber;
    case 'date': return isoDate;
    case 'boolean': return z.enum(['true', 'false']);
    case 'select': return z.enum((definition.options ?? []) as [string, ...string[]]);
  }
}

/** Raw form value for one field: string from an input, null when absent. Booleans arrive as checkbox 'on' or absent. */
export function normalizeRawValue(fieldType: CustomFieldType, raw: FormDataEntryValue | null): string {
  if (fieldType === 'boolean') return raw === 'on' || raw === 'true' ? 'true' : 'false';
  return typeof raw === 'string' ? raw.trim() : '';
}

export type CoercedValue = { ok: true; value: string | null } | { ok: false; error: string };

/** Validates one value against its definition. `value: null` means "clear the stored value". */
export function coerceFieldValue(definition: CustomFieldDefinitionShape, raw: FormDataEntryValue | null): CoercedValue {
  const normalized = normalizeRawValue(definition.fieldType, raw);
  if (normalized === '') return definition.required ? { ok: false, error: 'required' } : { ok: true, value: null };
  const parsed = valueSchema(definition).safeParse(normalized);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'invalid' };
}

export type ParsedFieldValues =
  | { ok: true; values: { definitionId: string; value: string | null }[] }
  | { ok: false; fieldErrors: Record<string, string[]> };

/** Validates every definition's value from a form whose inputs are named `field_<definitionId>`. */
export function parseFieldValues(definitions: CustomFieldDefinitionShape[], form: FormData): ParsedFieldValues {
  const values: { definitionId: string; value: string | null }[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const definition of definitions) {
    const result = coerceFieldValue(definition, form.get(fieldInputName(definition.id)));
    if (result.ok) values.push({ definitionId: definition.id, value: result.value });
    else fieldErrors[definition.id] = [result.error];
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, values };
}

export function fieldInputName(definitionId: string): string {
  return `field_${definitionId}`;
}
