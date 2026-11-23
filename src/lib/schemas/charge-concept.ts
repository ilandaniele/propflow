import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((value) => value || null);

export const SaveChargeConceptSchema = z.object({
  id: z.string().guid().optional().or(z.literal('')).transform((value) => value || null),
  description: z.string().trim().min(1).max(200),
  code: optionalText(40),
  base_amount: z.union([z.literal(''), z.coerce.number().min(0).max(9_999_999)]).optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});

export type SaveChargeConceptInput = z.infer<typeof SaveChargeConceptSchema>;
