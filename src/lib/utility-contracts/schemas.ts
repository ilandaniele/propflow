import { z } from 'zod';

export const UTILITY_TYPES = ['luz', 'agua', 'gas', 'internet', 'otro'] as const;
export const HOLDER_KINDS = ['owner', 'tenant', 'other'] as const;

const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const contractFields = {
  unit_id: z.preprocess(blankToUndefined, z.string().guid().optional()),
  utility_type: z.enum(UTILITY_TYPES),
  provider: z.string().trim().min(1).max(80),
  supply_number: optionalText(60),
  monthly_estimate: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(9_999_999).optional()),
  start_date: z.preprocess(blankToUndefined, isoDate.optional()),
  notes: optionalText(1000),
};

const holderFields = {
  holder_kind: z.enum(HOLDER_KINDS),
  holder_name: z.string().trim().min(1).max(120),
};

export const CreateUtilityContractSchema = z.object({
  property_id: z.string().guid(),
  ...contractFields,
  ...holderFields,
});

export const UpdateUtilityContractSchema = z.object({
  id: z.string().guid(),
  ...contractFields,
});

export const ChangeUtilityHolderSchema = z.object({
  id: z.string().guid(),
  changed_on: isoDate,
  reason: optionalText(300),
  ...holderFields,
});

export const DeleteUtilityContractSchema = z.object({ id: z.string().guid() });

export type ContractInput = z.infer<typeof UpdateUtilityContractSchema>;
