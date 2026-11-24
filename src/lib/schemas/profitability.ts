import { z } from 'zod';

export const ProfitabilityQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getFullYear()),
  property_id: z
    .string()
    .max(64)
    .optional()
    .transform((value) => value || undefined),
});

export type ProfitabilityQuery = z.infer<typeof ProfitabilityQuerySchema>;
