import { z } from 'zod';

export const CreatePaymentLinkSchema = z.object({
  charge_id: z.guid(),
});
