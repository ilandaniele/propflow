import { z } from 'zod';

export const EMPLOYMENT_TYPES = ['employee', 'self_employed', 'retired', 'student', 'other'] as const;
export const APPLICATION_STATUSES = ['new', 'reviewing', 'approved', 'rejected'] as const;

export const RentalApplicationSchema = z.object({
  listing_slug:      z.string().max(200).optional().or(z.literal('')),
  full_name:         z.string().trim().min(2).max(120),
  email:             z.string().trim().toLowerCase().email().max(200),
  phone:             z.string().trim().min(6).max(20),
  monthly_income:    z.coerce.number().positive().max(10_000_000),
  employment_type:   z.enum(EMPLOYMENT_TYPES),
  employment_months: z.coerce.number().int().min(0).max(600),
  household_size:    z.coerce.number().int().min(1).max(20),
  has_guarantor:     z.literal('on').optional(),
  move_in_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  message:           z.string().trim().max(1000).optional(),
  privacy_accepted:  z.literal('on'),
});

export type RentalApplicationInput = z.infer<typeof RentalApplicationSchema>;

export const UpdateApplicationStatusSchema = z.object({
  application_id: z.string().guid(),
  status:         z.enum(APPLICATION_STATUSES),
});
