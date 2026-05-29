import { z } from 'zod';

export const CreateTenantSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export const UpdateTenantSchema = CreateTenantSchema.partial().extend({
  id: z.string().uuid(),
});

export const AssignTenantToUnitSchema = z.object({
  tenant_id: z.string().uuid(),
  unit_id: z.string().uuid(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>;
export type AssignTenantToUnitInput = z.infer<typeof AssignTenantToUnitSchema>;
