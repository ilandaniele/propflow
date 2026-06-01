import { z } from 'zod';

export const SANCTION_KINDS = ['monetary', 'warning'] as const;
export const SANCTION_STATUSES = ['proposed', 'approved', 'rejected', 'disputed', 'resolved'] as const;

export const ProposeSanctionSchema = z.object({
  tenant_id: z.string().uuid(),
  kind: z.enum(SANCTION_KINDS),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(1000),
  amount: z.coerce.number().positive().max(999_999).optional().nullable(),
}).refine(
  (d) => d.kind !== 'monetary' || (d.amount !== undefined && d.amount !== null),
  { message: 'Amount is required for monetary sanctions', path: ['amount'] }
).refine(
  (d) => d.kind !== 'warning' || !d.amount,
  { message: 'Amount must not be set for warning sanctions', path: ['amount'] }
);
export type ProposeSanctionInput = z.infer<typeof ProposeSanctionSchema>;

export const ApproveSanctionSchema = z.object({
  id: z.string().uuid(),
});

export const RejectSanctionSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const DisputeSanctionSchema = z.object({
  id: z.string().uuid(),
  dispute_reason: z.string().min(1).max(1000),
});
export type DisputeSanctionInput = z.infer<typeof DisputeSanctionSchema>;
