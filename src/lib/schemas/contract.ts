import { z } from 'zod';

export const CreateContractSchema = z.object({
  tenant_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  monthly_rent: z.coerce.number().positive('Rent must be positive').max(9_999_999),
  deposit: z.coerce.number().min(0).max(9_999_999).optional(),
}).refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  { message: 'End date must be after start date', path: ['end_date'] }
);

export const UpdateContractStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'expired', 'terminated']),
});

export type CreateContractInput = z.infer<typeof CreateContractSchema>;
export type UpdateContractStatusInput = z.infer<typeof UpdateContractStatusSchema>;
