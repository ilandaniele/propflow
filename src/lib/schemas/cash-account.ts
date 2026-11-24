import { z } from 'zod';

const optionalText = (max: number) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().max(max).optional());

export const CashAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['cash', 'bank']),
  bank_name: optionalText(80),
  account_number: optionalText(40),
  opening_balance: z.coerce.number().min(-10_000_000).max(10_000_000),
});

export const CashMovementSchema = z.object({
  account_id: z.string().guid(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  concept: z.string().trim().min(1).max(160),
  document: optionalText(60),
  direction: z.enum(['in', 'out']),
  amount: z.coerce.number().positive().max(10_000_000),
});

export const CashExportQuerySchema = z.union([
  z.object({ year: z.coerce.number().int().min(2000).max(2100) }),
  z.object({ account: z.string().guid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
]);

export type CashAccountInput = z.infer<typeof CashAccountSchema>;
export type CashMovementInput = z.infer<typeof CashMovementSchema>;
