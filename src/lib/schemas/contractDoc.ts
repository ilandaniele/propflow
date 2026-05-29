import { z } from 'zod';

export const ContractTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  body_markdown: z.string().min(1).max(50_000),
  variables: z.string().optional().default('[]'), // JSON string of string[]
});
export type ContractTemplateInput = z.infer<typeof ContractTemplateSchema>;

export const UpdateContractTemplateSchema = ContractTemplateSchema.extend({
  id: z.string().uuid(),
});
export type UpdateContractTemplateInput = z.infer<typeof UpdateContractTemplateSchema>;

export const GeneratePdfSchema = z.object({
  contract_id: z.string().uuid(),
  template_id: z.string().uuid(),
});
export type GeneratePdfInput = z.infer<typeof GeneratePdfSchema>;

export const SendSignatureSchema = z.object({
  contract_id: z.string().uuid(),
});
export type SendSignatureInput = z.infer<typeof SendSignatureSchema>;

// Public sign page submission (Zod for Route Handler body)
const MAX_SIGNATURE_BYTES = 200_000; // ~200KB for base64 canvas image

export const SignSubmitSchema = z.object({
  signature_image_base64: z
    .string()
    .min(1)
    .max(MAX_SIGNATURE_BYTES, 'Signature image too large')
    .regex(/^data:image\/png;base64,/, 'Must be a PNG data URL'),
  typed_name: z.string().min(1).max(200),
});
export type SignSubmitInput = z.infer<typeof SignSubmitSchema>;
