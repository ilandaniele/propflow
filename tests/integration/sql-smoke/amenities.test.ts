import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.ctx.role !== 'admin') throw new Error('FORBIDDEN');
    return auth.ctx;
  }),
  requireUser: vi.fn(async () => auth.ctx),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { bookAmenity, cancelAmenityBooking, createAmenity, setAmenityActive } from '@/app/actions/amenities';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const FUTURE = '2099-01-10';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seedTenant(orgId: string, propertyId: string, label: string) {
  const profile = await seedProfile(db, orgId, { role: 'tenant', email: `${label}@example.com` });
  const [unit] = await db.insert(schema.units).values({ orgId, propertyId, label }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId, fullName: `Tenant ${label}`, unitId: unit.id, profileId: profile.id }).returning();
  await db.insert(schema.contracts).values({ orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '800.00' });
  return { profileId: profile.id, tenantId: tenant.id };
}

async function seedBuilding() {
  const org = await seedOrg(db);
  const admin = await seedProfile(db, org.id, { email: `admin-${org.id}@example.com` });
  const property = await seedProperty(db, org.id);
  auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
  const created = await createAmenity(null, form({ property_id: property.id, name: 'Parrilla', open_time: '10:00', close_time: '14:00', slot_minutes: '120' }));
  return { org, admin, property, amenityId: created.data!.amenityId };
}

const asTenant = (orgId: string, profileId: string) => { auth.ctx = { userId: profileId, orgId, role: 'tenant' }; };
const book = (amenityId: string, startTime: string, extra: Record<string, string> = {}) =>
  bookAmenity(null, form({ amenity_id: amenityId, booked_on: FUTURE, start_time: startTime, ...extra }));

describe('common-area bookings (real SQL)', () => {
  it('creates amenities per property and rejects duplicates, foreign properties and bad hours', async () => {
    const { org, property } = await seedBuilding();
    const other = await seedProperty(db, (await seedOrg(db)).id);

    expect((await createAmenity(null, form({ property_id: property.id, name: 'Parrilla', open_time: '10:00', close_time: '14:00', slot_minutes: '60' }))).error?.code).toBe('CONFLICT');
    expect((await createAmenity(null, form({ property_id: other.id, name: 'Sum', open_time: '10:00', close_time: '14:00', slot_minutes: '60' }))).error?.code).toBe('NOT_FOUND');
    expect((await createAmenity(null, form({ property_id: property.id, name: 'Sum', open_time: '14:00', close_time: '10:00', slot_minutes: '60' }))).error?.code).toBe('VALIDATION_ERROR');

    const rows = await db.select().from(schema.amenities).where(eq(schema.amenities.orgId, org.id));
    expect(rows).toHaveLength(1);
  });

  it('lets a tenant book a free slot once and blocks the slot for others until cancelled', async () => {
    const { org, property, amenityId } = await seedBuilding();
    const first = await seedTenant(org.id, property.id, 'A1');
    const second = await seedTenant(org.id, property.id, 'A2');

    asTenant(org.id, first.profileId);
    const booked = await book(amenityId, '12:00', { tenant_id: second.tenantId });
    expect(booked.error).toBeUndefined();
    const [row] = await db.select().from(schema.amenityBookings).where(eq(schema.amenityBookings.id, booked.data!.bookingId));
    expect(row).toMatchObject({ tenantId: first.tenantId, startTime: '12:00', endTime: '14:00', status: 'confirmed', createdBy: first.profileId });

    asTenant(org.id, second.profileId);
    expect((await book(amenityId, '12:00')).error?.code).toBe('CONFLICT');
    expect((await cancelAmenityBooking(null, form({ id: row.id }))).error?.code).toBe('NOT_FOUND');

    asTenant(org.id, first.profileId);
    expect((await cancelAmenityBooking(null, form({ id: row.id }))).error).toBeUndefined();

    asTenant(org.id, second.profileId);
    expect((await book(amenityId, '12:00')).error).toBeUndefined();
  });

  it('rejects off-grid, past, inactive and out-of-building bookings', async () => {
    const { org, property, amenityId } = await seedBuilding();
    const tenant = await seedTenant(org.id, property.id, 'B1');
    const otherBuilding = await seedProperty(db, org.id, { name: 'Torre 2' });
    const outsider = await seedTenant(org.id, otherBuilding.id, 'C1');
    const noContract = await seedProfile(db, org.id, { role: 'tenant', email: `nc-${org.id}@example.com` });

    asTenant(org.id, tenant.profileId);
    expect((await book(amenityId, '11:00')).error?.code).toBe('INVALID_SLOT');
    expect((await bookAmenity(null, form({ amenity_id: amenityId, booked_on: '2000-01-01', start_time: '10:00' }))).error?.code).toBe('PAST_DATE');

    asTenant(org.id, outsider.profileId);
    expect((await book(amenityId, '10:00')).error?.code).toBe('NOT_FOUND');

    asTenant(org.id, noContract.id);
    expect((await book(amenityId, '10:00')).error?.code).toBe('FORBIDDEN');

    asTenant(org.id, tenant.profileId);
    expect((await setAmenityActive(null, form({ id: amenityId, active: 'false' }))).error?.code).toBe('UNAUTHORIZED');

    const admin = await seedProfile(db, org.id, { email: `admin2-${org.id}@example.com` });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    expect((await setAmenityActive(null, form({ id: amenityId, active: 'false' }))).error).toBeUndefined();
    asTenant(org.id, tenant.profileId);
    expect((await book(amenityId, '10:00')).error?.code).toBe('INACTIVE');
    expect(await db.select().from(schema.amenityBookings).where(eq(schema.amenityBookings.amenityId, amenityId))).toHaveLength(0);
  });

  it('stores guest count and comment, enforces amenity capacity and the guest_count check', async () => {
    const { org, property } = await seedBuilding();
    const created = await createAmenity(null, form({ property_id: property.id, name: 'SUM', open_time: '10:00', close_time: '14:00', slot_minutes: '120', capacity: '20' }));
    expect(created.error).toBeUndefined();
    const amenityId = created.data!.amenityId;
    const [amenity] = await db.select().from(schema.amenities).where(eq(schema.amenities.id, amenityId));
    expect(amenity.capacity).toBe(20);

    const tenant = await seedTenant(org.id, property.id, 'G1');
    asTenant(org.id, tenant.profileId);
    expect((await book(amenityId, '10:00', { guest_count: '21' })).error?.code).toBe('VALIDATION_ERROR');
    expect((await book(amenityId, '10:00', { guest_count: '0' })).error?.code).toBe('VALIDATION_ERROR');

    const booked = await book(amenityId, '10:00', { guest_count: '20', comment: '  Cumpleaños  ' });
    expect(booked.error).toBeUndefined();
    const [row] = await db.select().from(schema.amenityBookings).where(eq(schema.amenityBookings.id, booked.data!.bookingId));
    expect(row).toMatchObject({ guestCount: 20, comment: 'Cumpleaños' });

    await expect(db.update(schema.amenityBookings).set({ guestCount: 501 }).where(eq(schema.amenityBookings.id, row.id))).rejects.toThrow();
    await expect(db.update(schema.amenityBookings).set({ guestCount: 0 }).where(eq(schema.amenityBookings.id, row.id))).rejects.toThrow();
    await expect(db.update(schema.amenities).set({ capacity: 0 }).where(eq(schema.amenities.id, amenityId))).rejects.toThrow();
  });

  it('accepts any guest count up to 500 when the amenity has no capacity', async () => {
    const { org, property, amenityId } = await seedBuilding();
    const tenant = await seedTenant(org.id, property.id, 'H1');
    asTenant(org.id, tenant.profileId);
    const booked = await book(amenityId, '10:00', { guest_count: '500' });
    expect(booked.error).toBeUndefined();
    const [row] = await db.select().from(schema.amenityBookings).where(eq(schema.amenityBookings.id, booked.data!.bookingId));
    expect(row).toMatchObject({ guestCount: 500, comment: null });
  });

  it('lets admins book for a tenant of their org and cancel any booking, never across orgs', async () => {
    const { org, property, amenityId } = await seedBuilding();
    const tenant = await seedTenant(org.id, property.id, 'D1');
    const adminCtx = { ...auth.ctx };

    const booked = await book(amenityId, '10:00', { tenant_id: tenant.tenantId });
    expect(booked.error).toBeUndefined();

    const strangerOrg = await seedOrg(db);
    const strangerProperty = await seedProperty(db, strangerOrg.id);
    const stranger = await seedTenant(strangerOrg.id, strangerProperty.id, 'E1');
    expect((await book(amenityId, '12:00', { tenant_id: stranger.tenantId })).error?.code).toBe('NOT_FOUND');

    const strangerAdmin = await seedProfile(db, strangerOrg.id, { email: `admin-${strangerOrg.id}@example.com` });
    auth.ctx = { userId: strangerAdmin.id, orgId: strangerOrg.id, role: 'admin' };
    expect((await book(amenityId, '12:00')).error?.code).toBe('NOT_FOUND');
    expect((await cancelAmenityBooking(null, form({ id: booked.data!.bookingId }))).error?.code).toBe('NOT_FOUND');

    auth.ctx = adminCtx;
    expect((await cancelAmenityBooking(null, form({ id: booked.data!.bookingId }))).error).toBeUndefined();
    const [row] = await db.select().from(schema.amenityBookings).where(eq(schema.amenityBookings.id, booked.data!.bookingId));
    expect(row.status).toBe('cancelled');
  });
});
