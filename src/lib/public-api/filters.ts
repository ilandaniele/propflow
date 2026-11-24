import { z } from 'zod';

export const NoFilters = z.object({});

export const UnitFilters = z.object({
  propertyId: z.string().uuid().optional(),
});

export const PaymentFilters = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  status: z.enum(['pending', 'approved', 'under_review', 'rejected']).optional(),
});
