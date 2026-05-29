import { z } from 'zod';

export const CreateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
});
export type CreateExpenseCategoryInput = z.infer<typeof CreateExpenseCategorySchema>;

export const CreateExpenseSchema = z.object({
  property_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  amount: z.coerce.number().positive().max(999_999_99),
  description: z.string().min(1).max(500),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid().optional(),
  unit_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  amount: z.coerce.number().positive().max(999_999_99).optional(),
  description: z.string().min(1).max(500).optional(),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>;

// 5 MB in bytes
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;

export const UploadReceiptSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size: z.coerce.number().int().positive().max(MAX_RECEIPT_BYTES, 'File must be ≤ 5 MB'),
  mime_type: z.enum(ALLOWED_RECEIPT_MIMES),
});
export type UploadReceiptInput = z.infer<typeof UploadReceiptSchema>;

export const MatchReceiptSchema = z.object({
  receipt_id: z.string().uuid(),
  payment_id: z.string().uuid(),
});
export type MatchReceiptInput = z.infer<typeof MatchReceiptSchema>;

export const OcrRequestSchema = z.object({
  receipt_id: z.string().uuid(),
});
export type OcrRequestInput = z.infer<typeof OcrRequestSchema>;

// Zod shape for the OCR JSON response from Claude
export const OcrExtractedSchema = z.object({
  amount: z.number().positive().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  vendor: z.string().max(200).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
});
export type OcrExtracted = z.infer<typeof OcrExtractedSchema>;
