import { z } from 'zod';
import { publicApiRoute } from '@/lib/public-api/handler';
import { listPaymentsForApi } from '@/lib/public-api/queries';

export const dynamic = 'force-dynamic';

const PaymentFilters = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  status: z.enum(['pending', 'approved', 'under_review', 'rejected']).optional(),
});

export const GET = publicApiRoute('payments', PaymentFilters, listPaymentsForApi);
