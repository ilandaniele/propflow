import { z } from 'zod';

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const PeriodSchema = z.string().regex(PERIOD_PATTERN, 'Use the YYYY-MM format');

export const ClosePeriodSchema = z.object({
  period: PeriodSchema,
  note: z.string().trim().max(500).optional().transform((value) => value || undefined),
});

export const ReopenPeriodSchema = z.object({
  period: PeriodSchema,
});

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function periodsOf(dates: Array<string | null | undefined>): string[] {
  return [...new Set(dates.filter((date): date is string => Boolean(date)).map(periodOf))];
}
