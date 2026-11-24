import { z } from 'zod';

export const RentAdjustmentSchema = z.object({
  contract_id: z.string().guid(),
  percent: z.coerce.number().min(-50).max(100).refine((value) => value !== 0, 'Percent cannot be zero'),
  effective_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});
