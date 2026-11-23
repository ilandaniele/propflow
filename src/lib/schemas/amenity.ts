import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AmenitySchema = z.object({
  property_id: z.string().guid(),
  name: z.string().trim().min(1).max(80),
  open_time: time,
  close_time: time,
  slot_minutes: z.coerce.number().int().min(15).max(720),
}).refine((value) => value.open_time < value.close_time, { path: ['close_time'], message: 'close_time must be after open_time' });

export const BookAmenitySchema = z.object({
  amenity_id: z.string().guid(),
  booked_on: date,
  start_time: time,
  tenant_id: z.string().guid().optional().or(z.literal('').transform(() => undefined)),
});

export const CancelAmenityBookingSchema = z.object({ id: z.string().guid() });

export type AmenityInput = z.infer<typeof AmenitySchema>;
export type BookAmenityInput = z.infer<typeof BookAmenitySchema>;
