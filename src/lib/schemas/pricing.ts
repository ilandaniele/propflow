import { z } from 'zod';

export const PricingTierSchema = z.object({
  label: z.string().min(1).max(100),
  bedrooms: z.coerce.number().int().min(0).max(20),
  min_rent: z.coerce.number().positive(),
  max_rent: z.coerce.number().positive(),
  suggested_rent: z.coerce.number().positive(),
});
export type PricingTierInput = z.infer<typeof PricingTierSchema>;

export const PricingTableSchema = z.object({
  name: z.string().min(1).max(200),
  property_type: z.string().min(1).max(100),
  market_zone: z.string().min(1).max(100),
  tiers: z.string().min(2).max(10_000), // JSON string of PricingTier[]
});
export type PricingTableInput = z.infer<typeof PricingTableSchema>;

export const UpdatePricingTableSchema = PricingTableSchema.extend({
  id: z.string().uuid(),
});
export type UpdatePricingTableInput = z.infer<typeof UpdatePricingTableSchema>;
