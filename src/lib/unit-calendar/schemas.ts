import { z } from 'zod';
import { isAllowedCalendarUrl } from './remote';

export const UnitCalendarSchema = z.object({ unit_id: z.string().min(1) });

export const UnitCalendarImportSchema = UnitCalendarSchema.extend({
  import_url: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null)
    .refine((v) => v === null || isAllowedCalendarUrl(v), 'Use the https iCal export link from Airbnb, Booking or Vrbo'),
});
