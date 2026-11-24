import { z } from 'zod';

const optionalGuid = z.preprocess((v) => (v === '' ? undefined : v), z.string().guid().optional());

export const CreateRecurringExpenseSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: z.coerce.number().positive().max(999_999_99),
  day_of_month: z.coerce.number().int().min(1).max(28),
  property_id: optionalGuid,
  category_id: optionalGuid,
});
export type CreateRecurringExpenseInput = z.infer<typeof CreateRecurringExpenseSchema>;

export const ToggleRecurringExpenseSchema = z.object({
  id: z.string().guid(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const DeleteRecurringExpenseSchema = z.object({ id: z.string().guid() });
