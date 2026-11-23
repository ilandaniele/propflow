import { z } from 'zod';

export const GenerateStatementsSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
