import { z } from 'zod';
import { SUPPLIER_ASSIGNMENT_STATUSES, SUPPLIER_TRADES } from '@/lib/suppliers/constants';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => (value ? value : null));

const MAX_AMOUNT = 99_999_999;

const optionalAmount = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
      ctx.addIssue({ code: 'custom', message: 'Invalid amount' });
      return z.NEVER;
    }
    return amount.toFixed(2);
  });

export const SupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trade: z.enum(SUPPLIER_TRADES),
  phone: optionalText(40),
  email: z.string().trim().email().max(200).optional().or(z.literal('')).transform((value) => value || null),
  notes: optionalText(1000),
});
export type SupplierInput = z.infer<typeof SupplierSchema>;

export const UpdateSupplierSchema = SupplierSchema.extend({ id: z.string().min(1) });

export const SetSupplierActiveSchema = z.object({
  id: z.string().min(1),
  active: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

export const AssignSupplierSchema = z.object({
  incident_id: z.string().min(1),
  supplier_id: z.string().min(1),
});

export const UpdateAssignmentSchema = z.object({
  incident_id: z.string().min(1),
  status: z.enum(SUPPLIER_ASSIGNMENT_STATUSES),
  quote_amount: optionalAmount,
  final_cost: optionalAmount,
  notes: optionalText(1000),
});
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
