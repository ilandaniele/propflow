import { z } from 'zod';

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 8;

const optionLines = z
  .string()
  .transform((raw) => [...new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))])
  .pipe(z.array(z.string().max(120)).min(MIN_POLL_OPTIONS).max(MAX_POLL_OPTIONS));

export const CreatePollSchema = z.object({
  question: z.string().trim().min(3).max(200),
  options: optionLines,
  closes_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const PollIdSchema = z.object({ poll_id: z.string().uuid() });

export const CastVoteSchema = z.object({
  poll_id: z.string().uuid(),
  option_id: z.string().uuid(),
});

export function endOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999Z`);
}
