import { z } from 'zod';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ConvertLeadSchema = z.object({
  lead_id: z.string().guid(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  unit_id: z.string().guid(),
  start_date: z.string().regex(DATE),
  end_date: z.string().regex(DATE),
  monthly_rent: z.coerce.number().positive().max(9_999_999),
  deposit: z.union([z.literal(''), z.coerce.number().min(0).max(9_999_999)]).optional(),
}).refine(
  (data) => data.end_date > data.start_date,
  { message: 'End date must be after start date', path: ['end_date'] },
);

export type ConvertLeadInput = z.infer<typeof ConvertLeadSchema>;
