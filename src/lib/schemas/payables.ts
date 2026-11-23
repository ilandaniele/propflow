import { z } from 'zod';
import { PAYABLE_STATUSES } from '@/lib/finance/payables/status';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 99_999_999;

const isoDate = z.string().regex(DATE);

const money = z.coerce.number().positive().max(MAX_AMOUNT).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
  { message: 'At most two decimals' },
);

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || undefined);

const optionalId = z.union([z.literal(''), z.string().guid()]).optional().transform((value) => value || undefined);

export const CreatePayableSchema = z.object({
  property_id: optionalId,
  category_id: optionalId,
  supplier_name: z.string().trim().min(1).max(200),
  description: optionalText(500),
  document_ref: optionalText(100),
  amount: money,
  issued_on: isoDate,
  due_on: isoDate,
}).refine(
  (data) => data.due_on >= data.issued_on,
  { message: 'Due date must not be before the issue date', path: ['due_on'] },
);
export type CreatePayableInput = z.infer<typeof CreatePayableSchema>;

export const RegisterPayablePaymentSchema = z.object({
  payable_id: z.string().guid(),
  amount: money,
  paid_on: isoDate,
  note: optionalText(500),
});
export type RegisterPayablePaymentInput = z.infer<typeof RegisterPayablePaymentSchema>;

export const PayableFiltersSchema = z.object({
  status: z.enum(PAYABLE_STATUSES).optional().catch(undefined),
  due_from: isoDate.optional().catch(undefined),
  due_to: isoDate.optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});
export type PayableFilters = z.infer<typeof PayableFiltersSchema>;
