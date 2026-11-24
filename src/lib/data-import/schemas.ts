import { z } from 'zod';

export const DATA_IMPORT_KINDS = ['properties', 'units', 'owners'] as const;
export type DataImportKind = (typeof DATA_IMPORT_KINDS)[number];

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const required = (max: number) => z.string().trim().min(1).max(max);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const optionalText = (max: number) => optional(z.string().trim().max(max));

export const PropertyRowSchema = z.object({
  name:     required(200),
  address:  optionalText(300),
  city:     optionalText(100),
  district: optionalText(100),
  country:  optionalText(100),
});

export const UnitRowSchema = z.object({
  property_name: required(200),
  label:         required(50),
  floor:         optionalText(20),
  bedrooms:      optional(z.coerce.number().int().min(0).max(50)),
  monthly_rent:  optional(z.string().trim().regex(/^\d+(\.\d{1,2})?$/)),
  toilet_type:   optional(z.enum(['shared', 'private', 'none'])),
});

export const OwnerRowSchema = z.object({
  name:      required(200),
  dni:       optionalText(20),
  phone:     optionalText(30),
  email:     optional(z.email().max(200)),
  domicilio: optionalText(300),
  distrito:  optionalText(100),
});

export const DATA_IMPORT_COLUMNS: Record<DataImportKind, readonly string[]> = {
  properties: Object.keys(PropertyRowSchema.shape),
  units:      Object.keys(UnitRowSchema.shape),
  owners:     Object.keys(OwnerRowSchema.shape),
};

export const DataImportFormSchema = z.object({
  kind: z.enum(DATA_IMPORT_KINDS),
  file: z.instanceof(File).refine((file) => file.size > 0),
});
