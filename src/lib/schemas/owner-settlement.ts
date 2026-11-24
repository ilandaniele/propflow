import { z } from 'zod';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export const SettlementQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .default(currentMonth),
  owner_id: z
    .string()
    .max(64)
    .optional()
    .transform((value) => value || undefined),
});

export const PropertyOwnerTermsSchema = z.object({
  property_id: z.string().min(1).max(64),
  owner_id: z.string().min(1).max(64),
  commission_pct: z.coerce.number().min(0).max(100).transform((value) => value.toFixed(2)),
});

export const OwnerPortalLinkSchema = z.object({ owner_id: z.string().min(1).max(64) });

export const RevokeOwnerPortalLinkSchema = z.object({ link_id: z.string().min(1).max(64) });
