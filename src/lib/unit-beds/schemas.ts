import { z } from 'zod';

const optionalRent = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().min(0).max(9_999_999).optional(),
);

export const CreateUnitBedSchema = z.object({
  unit_id: z.string().guid(),
  label: z.string().trim().min(1).max(40),
  monthly_rent: optionalRent,
});

export const AssignUnitBedSchema = z.object({
  id: z.string().guid(),
  tenant_id: z.preprocess((value) => (value === '' ? null : value), z.string().guid().nullable()),
});

export const DeleteUnitBedSchema = z.object({ id: z.string().guid() });
