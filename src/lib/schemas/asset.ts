import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || undefined);
const optionalAmount = z
  .union([z.literal('').transform(() => undefined), z.coerce.number().min(0).max(9_999_999)])
  .optional();

export const ASSET_CATEGORIES = ['elevator', 'pump', 'electrical', 'plumbing', 'fire_safety', 'hvac', 'security', 'structure', 'other'] as const;

export const AssetSchema = z.object({
  property_id: z.string().guid(),
  name: z.string().trim().min(1).max(80),
  category: z.enum(ASSET_CATEGORIES),
  location: optionalText(120),
});

export const AssetTaskSchema = z.object({
  asset_id: z.string().guid(),
  title: z.string().trim().min(1).max(120),
  frequency_months: z.coerce.number().int().min(1).max(120),
  starts_on: date,
  responsible: optionalText(80),
  supplier: optionalText(80),
  estimated_cost: optionalAmount,
});

export const CompleteAssetTaskSchema = z.object({
  task_id: z.string().guid(),
  done_on: date,
  cost: optionalAmount,
  notes: optionalText(500),
});

export type AssetInput = z.infer<typeof AssetSchema>;
export type AssetTaskInput = z.infer<typeof AssetTaskSchema>;
export type CompleteAssetTaskInput = z.infer<typeof CompleteAssetTaskSchema>;
