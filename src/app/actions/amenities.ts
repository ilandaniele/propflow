'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors, err, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { AmenitySchema, BookAmenitySchema, CancelAmenityBookingSchema } from '@/lib/schemas/amenity';
import {
  bookAmenity as saveBooking,
  cancelAmenityBooking as cancelBooking,
  createAmenity as saveAmenity,
  setAmenityActive as saveAmenityActive,
  tenantScope,
  type TenantScope,
} from '@/lib/amenities/amenities';

const SetActiveSchema = z.object({ id: z.string().guid(), active: z.enum(['true', 'false']) });

const BOOKING_ERRORS = {
  not_found: () => Errors.NOT_FOUND(),
  inactive: () => err('INACTIVE', 'This common area is not accepting bookings'),
  invalid_slot: () => err('INVALID_SLOT', 'That time slot does not exist'),
  past: () => err('PAST_DATE', 'Bookings must be for today or later'),
  taken: () => Errors.CONFLICT('That time slot is already booked'),
} as const;

function revalidateAmenities() {
  revalidatePath('/dashboard/amenities', 'layout');
  revalidatePath('/portal/amenities');
}

export async function createAmenity(
  _prev: ActionResult<{ amenityId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ amenityId: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'create-amenity');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = AmenitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const result = await saveAmenity(ctx.orgId, parsed.data);
  if (result.status === 'not_found') return Errors.NOT_FOUND();
  if (result.status === 'duplicate') return Errors.CONFLICT('A common area with that name already exists in this property');

  log.adminAction(ctx.userId, 'create_amenity', 'amenity', result.amenityId);
  revalidateAmenities();
  return ok({ amenityId: result.amenityId });
}

export async function setAmenityActive(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'amenity-active');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = SetActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await saveAmenityActive(ctx.orgId, parsed.data.id, parsed.data.active === 'true'))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'set_amenity_active', 'amenity', parsed.data.id);
  revalidateAmenities();
  return ok(undefined);
}

async function callerScope(ctx: { role: string; orgId: string; userId: string }): Promise<TenantScope | null | undefined> {
  if (ctx.role === 'admin') return undefined;
  if (ctx.role !== 'tenant') return null;
  return tenantScope(ctx.orgId, ctx.userId);
}

export async function bookAmenity(
  _prev: ActionResult<{ bookingId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ bookingId: string }>> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'book-amenity');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = BookAmenitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const scope = await callerScope(ctx);
  if (scope === null) return Errors.FORBIDDEN();

  const today = new Date().toISOString().slice(0, 10);
  const result = await saveBooking(ctx.orgId, ctx.userId, parsed.data, today, scope);
  if (result.status !== 'done') return BOOKING_ERRORS[result.status]();

  if (ctx.role === 'admin') log.adminAction(ctx.userId, 'book_amenity', 'amenity_booking', result.bookingId);
  revalidateAmenities();
  return ok({ bookingId: result.bookingId });
}

export async function cancelAmenityBooking(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireUser(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'cancel-amenity-booking');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CancelAmenityBookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const scope = await callerScope(ctx);
  if (scope === null) return Errors.FORBIDDEN();

  if (!(await cancelBooking(ctx.orgId, parsed.data.id, scope?.tenantId))) return Errors.NOT_FOUND();

  if (ctx.role === 'admin') log.adminAction(ctx.userId, 'cancel_amenity_booking', 'amenity_booking', parsed.data.id);
  revalidateAmenities();
  return ok(undefined);
}
