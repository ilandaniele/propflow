import { z } from 'zod';

export const ExpenseBudgetSchema = z.object({
  category_id: z.string().guid(),
  year: z.coerce.number().int().min(2000).max(2100),
  amount: z.coerce.number().min(0).max(100_000_000),
});

export type ExpenseBudgetInput = z.infer<typeof ExpenseBudgetSchema>;
