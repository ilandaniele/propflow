import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const StaffMemberSchema = z.object({
  property_id: z.preprocess(emptyToUndefined, z.string().guid().optional()),
  full_name: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(100),
  shift: optionalText(100),
  phone: optionalText(30),
  document_number: optionalText(30),
});

export const RemoveStaffMemberSchema = z.object({
  id: z.string().guid(),
});
