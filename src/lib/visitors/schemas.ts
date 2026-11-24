import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const PassphraseSchema = z.preprocess(emptyToUndefined, z.string().trim().min(5).max(40).optional());

export const AuthorizedVisitorSchema = z.object({
  unit_id: z.preprocess(emptyToUndefined, z.string().guid().optional()),
  full_name: z.string().trim().min(1).max(200),
  document_number: optionalText(30),
  relationship: optionalText(100),
});

export const RemoveAuthorizedVisitorSchema = z.object({
  id: z.string().guid(),
});
