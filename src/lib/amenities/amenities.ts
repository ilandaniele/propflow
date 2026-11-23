import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { amenities, amenityBookings, contracts, properties, tenants, units } from '@/lib/db/schema';
import type { AmenityInput, BookAmenityInput } from '@/lib/schemas/amenity';
import { daySlots, findSlot } from './slot-math';

export type CreateAmenityResult = { status: 'not_found' } | { status: 'duplicate' } | { status: 'done'; amenityId: string };
export type BookAmenityResult =
  | { status: 'not_found' }
  | { status: 'inactive' }
  | { status: 'invalid_slot' }
  | { status: 'past' }
  | { status: 'taken' }
  | { status: 'done'; bookingId: string };

export type TenantScope = { tenantId: string; propertyId: string };

export async function createAmenity(orgId: string, input: AmenityInput): Promise<CreateAmenityResult> {
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.property_id), eq(properties.orgId, orgId)))
    .limit(1);
  if (!property) return { status: 'not_found' };

  const now = new Date();
  try {
    const [row] = await db.insert(amenities).values({
      orgId,
      propertyId: input.property_id,
      name: input.name,
      openTime: input.open_time,
      closeTime: input.close_time,
      slotMinutes: input.slot_minutes,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: amenities.id });
    return { status: 'done', amenityId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    throw error;
  }
}

export async function setAmenityActive(orgId: string, amenityId: string, active: boolean): Promise<boolean> {
  const rows = await db
    .update(amenities)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(amenities.id, amenityId), eq(amenities.orgId, orgId)))
    .returning({ id: amenities.id });
  return rows.length > 0;
}

export function listAmenities(orgId: string, propertyId?: string) {
  const scope = propertyId
    ? and(eq(amenities.orgId, orgId), eq(amenities.propertyId, propertyId), eq(amenities.active, true))
    : eq(amenities.orgId, orgId);
  return db
    .select({
      id: amenities.id,
      name: amenities.name,
      propertyName: properties.name,
      openTime: amenities.openTime,
      closeTime: amenities.closeTime,
      slotMinutes: amenities.slotMinutes,
      active: amenities.active,
    })
    .from(amenities)
    .innerJoin(properties, eq(properties.id, amenities.propertyId))
    .where(scope)
    .orderBy(asc(properties.name), asc(amenities.name))
    .limit(200);
}

export function bookingsForDay(orgId: string, amenityId: string, bookedOn: string) {
  return db
    .select({
      id: amenityBookings.id,
      startTime: amenityBookings.startTime,
      tenantId: amenityBookings.tenantId,
      tenantName: tenants.fullName,
    })
    .from(amenityBookings)
    .leftJoin(tenants, eq(tenants.id, amenityBookings.tenantId))
    .where(and(
      eq(amenityBookings.orgId, orgId),
      eq(amenityBookings.amenityId, amenityId),
      eq(amenityBookings.bookedOn, bookedOn),
      eq(amenityBookings.status, 'confirmed'),
    ));
}

export function upcomingTenantBookings(orgId: string, tenantId: string, today: string) {
  return db
    .select({
      id: amenityBookings.id,
      amenityName: amenities.name,
      bookedOn: amenityBookings.bookedOn,
      startTime: amenityBookings.startTime,
      endTime: amenityBookings.endTime,
    })
    .from(amenityBookings)
    .innerJoin(amenities, eq(amenities.id, amenityBookings.amenityId))
    .where(and(
      eq(amenityBookings.orgId, orgId),
      eq(amenityBookings.tenantId, tenantId),
      eq(amenityBookings.status, 'confirmed'),
      gte(amenityBookings.bookedOn, today),
    ))
    .orderBy(asc(amenityBookings.bookedOn), asc(amenityBookings.startTime))
    .limit(50);
}

export async function tenantScope(orgId: string, profileId: string): Promise<TenantScope | null> {
  const [row] = await db
    .select({ tenantId: tenants.id, propertyId: units.propertyId })
    .from(tenants)
    .innerJoin(contracts, and(eq(contracts.tenantId, tenants.id), eq(contracts.status, 'active')))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(and(eq(tenants.profileId, profileId), eq(tenants.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

async function tenantInOrg(orgId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, orgId)))
    .limit(1);
  return Boolean(row);
}

export async function bookAmenity(
  orgId: string,
  createdBy: string,
  input: BookAmenityInput,
  today: string,
  scope?: TenantScope,
): Promise<BookAmenityResult> {
  const [amenity] = await db
    .select({ propertyId: amenities.propertyId, active: amenities.active, openTime: amenities.openTime, closeTime: amenities.closeTime, slotMinutes: amenities.slotMinutes })
    .from(amenities)
    .where(and(eq(amenities.id, input.amenity_id), eq(amenities.orgId, orgId)))
    .limit(1);
  if (!amenity || (scope && amenity.propertyId !== scope.propertyId)) return { status: 'not_found' };
  if (!amenity.active) return { status: 'inactive' };

  const slot = findSlot(daySlots(amenity.openTime, amenity.closeTime, amenity.slotMinutes), input.start_time);
  if (!slot) return { status: 'invalid_slot' };
  if (input.booked_on < today) return { status: 'past' };

  const tenantId = scope ? scope.tenantId : input.tenant_id ?? null;
  if (!scope && tenantId && !(await tenantInOrg(orgId, tenantId))) return { status: 'not_found' };

  const now = new Date();
  try {
    const [row] = await db.insert(amenityBookings).values({
      orgId,
      amenityId: input.amenity_id,
      tenantId,
      bookedOn: input.booked_on,
      startTime: slot.start,
      endTime: slot.end,
      createdBy,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: amenityBookings.id });
    return { status: 'done', bookingId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'taken' };
    throw error;
  }
}

export async function cancelAmenityBooking(orgId: string, bookingId: string, tenantId?: string): Promise<boolean> {
  const ownership = tenantId ? eq(amenityBookings.tenantId, tenantId) : undefined;
  const rows = await db
    .update(amenityBookings)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(amenityBookings.id, bookingId),
      eq(amenityBookings.orgId, orgId),
      eq(amenityBookings.status, 'confirmed'),
      ownership,
    ))
    .returning({ id: amenityBookings.id });
  return rows.length > 0;
}

export function orgPropertyOptions(orgId: string) {
  return db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(eq(properties.orgId, orgId))
    .orderBy(asc(properties.name))
    .limit(500);
}

export function propertyTenantOptions(orgId: string, propertyId: string) {
  return db
    .selectDistinct({ id: tenants.id, name: tenants.fullName })
    .from(tenants)
    .innerJoin(contracts, and(eq(contracts.tenantId, tenants.id), eq(contracts.status, 'active')))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .where(and(eq(tenants.orgId, orgId), eq(units.propertyId, propertyId)))
    .orderBy(asc(tenants.fullName))
    .limit(500);
}

export async function getAmenity(orgId: string, amenityId: string) {
  const [row] = await db
    .select({
      id: amenities.id,
      name: amenities.name,
      propertyId: amenities.propertyId,
      propertyName: properties.name,
      openTime: amenities.openTime,
      closeTime: amenities.closeTime,
      slotMinutes: amenities.slotMinutes,
      active: amenities.active,
    })
    .from(amenities)
    .innerJoin(properties, eq(properties.id, amenities.propertyId))
    .where(and(eq(amenities.id, amenityId), eq(amenities.orgId, orgId)))
    .limit(1);
  return row ?? null;
}
