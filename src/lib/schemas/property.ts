import { z } from 'zod';

export const CreatePropertySchema = z.object({
  name: z.string().min(1, 'Property name is required').max(200),
  address: z.string().max(500).optional().or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
  country: z.string().max(100).optional().or(z.literal('')),
});

export const UpdatePropertySchema = CreatePropertySchema.partial().extend({
  id: z.string().uuid(),
});

export const CreateUnitSchema = z.object({
  property_id: z.string().uuid(),
  label: z.string().min(1, 'Unit label is required').max(100),
  floor: z.string().max(50).optional().or(z.literal('')),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  // toilet_type: must match DB CHECK constraint IN ('shared', 'private', 'none')
  toilet_type: z.enum(['shared', 'private', 'none']).default('private'),
  monthly_rent_default: z.coerce.number().min(0).max(9_999_999).optional(),
});

export const UpdateUnitSchema = CreateUnitSchema.omit({ property_id: true }).partial().extend({
  id: z.string().uuid(),
});

export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>;
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;
export type CreateUnitInput = z.infer<typeof CreateUnitSchema>;
export type UpdateUnitInput = z.infer<typeof UpdateUnitSchema>;
