import { z } from 'zod';

export const MAX_STATEMENT_BYTES = 1_000_000;

export const MatchBankLineSchema = z.object({
  line_id: z.string().min(1),
  payment_id: z.string().min(1),
});

export const CreatePaymentFromBankLineSchema = z.object({
  line_id: z.string().min(1),
  contract_id: z.string().min(1),
});

export const SetBankLineIgnoredSchema = z.object({
  line_id: z.string().min(1),
  ignored: z.enum(['true', 'false']).transform((value) => value === 'true'),
});
