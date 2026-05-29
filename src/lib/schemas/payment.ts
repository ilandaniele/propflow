import { z } from 'zod';

export const RecordPaymentSchema = z.object({
  contract_id: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be positive').max(9_999_999),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  method: z.enum(['cash', 'transfer', 'card', 'other']).default('transfer'),
  reference: z.string().max(500).optional().or(z.literal('')),
});

export const ApprovePaymentSchema = z.object({
  payment_id: z.string().uuid(),
});

export const CreateChargeSchema = z.object({
  contract_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(9_999_999),
  description: z.string().min(1).max(500),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;
export type ApprovePaymentInput = z.infer<typeof ApprovePaymentSchema>;
export type CreateChargeInput = z.infer<typeof CreateChargeSchema>;
