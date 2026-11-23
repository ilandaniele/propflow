import { z } from 'zod';
import { SPLIT_METHODS } from '@/lib/finance/utility-split';

export const SplitUtilitySchema = z.object({
  service_payment_id: z.string().guid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  method: z.enum(SPLIT_METHODS),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SplitUtilityInput = z.infer<typeof SplitUtilitySchema>;
