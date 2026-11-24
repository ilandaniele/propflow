import { z } from 'zod';
import { DEPOSIT_MOVEMENT_KINDS } from '@/lib/db/schema';

export const DepositMovementSchema = z.object({
  contract_id: z.string().guid(),
  kind: z.enum(DEPOSIT_MOVEMENT_KINDS),
  amount: z.coerce.number().positive().max(10_000_000),
  moved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(300).optional().transform((value) => value || undefined),
});
