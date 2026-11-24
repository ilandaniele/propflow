import { z } from 'zod';
import { CUSTOMER_DOC_TYPES, DOC_TYPES } from '@/lib/einvoice/calc';

export const EmitEinvoiceSchema = z.object({
  charge_id: z.string().guid(),
  doc_type: z.enum(DOC_TYPES),
  customer_doc_type: z.enum(CUSTOMER_DOC_TYPES),
  customer_doc_number: z.string().trim().regex(/^\d{0,11}$/).optional().default(''),
  customer_name: z.string().trim().min(1).max(200),
});

export type EmitEinvoiceInput = z.infer<typeof EmitEinvoiceSchema>;
