import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (!authBox.ctx) throw new Error('unauthorized');
    return authBox.ctx;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { listUnitBeds } = await import('@/lib/unit-beds/queries');
const actions = await import('@/app/actions/unit-beds');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  authBox.ctx = null;
});

function formOf(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function seedUnit(orgId: string) {
  const property = await seedProperty(smoke.db, orgId);
  const [unit] = await smoke.db.insert(schema.units)
    .values({ id: crypto.randomUUID(), orgId, propertyId: property.id, label: 'U-1', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return unit;
}

async function seedTenant(orgId: string, fullName: string) {
  const [tenant] = await smoke.db.insert(schema.tenants)
    .values({ id: crypto.randomUUID(), orgId, fullName, createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return tenant;
}

async function signIn() {
  const org = await seedOrg(smoke.db);
  authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
  return org;
}

describe('createUnitBed', () => {
  it('rejects anonymous callers', async () => {
    const result = await actions.createUnitBed({}, formOf({ unit_id: crypto.randomUUID(), label: 'A' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rejects a blank label', async () => {
    const org = await signIn();
    const unit = await seedUnit(org.id);
    expect((await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: ' ' }))).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a unit from another org', async () => {
    const other = await seedOrg(smoke.db);
    const foreignUnit = await seedUnit(other.id);
    await signIn();
    expect((await actions.createUnitBed({}, formOf({ unit_id: foreignUnit.id, label: 'A' }))).error?.code).toBe('NOT_FOUND');
  });

  it('creates beds, rejects duplicate labels and lists them in label order', async () => {
    const org = await signIn();
    const unit = await seedUnit(org.id);
    expect((await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'B', monthly_rent: '350' }))).error).toBeUndefined();
    expect((await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'A', monthly_rent: '' }))).error).toBeUndefined();
    expect((await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'A' }))).error?.code).toBe('CONFLICT');

    const beds = await listUnitBeds(org.id, unit.id);
    expect(beds.map((bed) => [bed.label, bed.monthlyRent])).toEqual([['A', null], ['B', '350.00']]);
  });
});

describe('assignUnitBed', () => {
  it('assigns, blocks a second bed for the same tenant, then vacates', async () => {
    const org = await signIn();
    const unit = await seedUnit(org.id);
    const tenant = await seedTenant(org.id, 'Tenant One');
    await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'A' }));
    await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'B' }));
    const [bedA, bedB] = await listUnitBeds(org.id, unit.id);

    expect((await actions.assignUnitBed({}, formOf({ id: bedA.id, tenant_id: tenant.id }))).error).toBeUndefined();
    expect((await actions.assignUnitBed({}, formOf({ id: bedA.id, tenant_id: tenant.id }))).error).toBeUndefined();
    expect((await actions.assignUnitBed({}, formOf({ id: bedB.id, tenant_id: tenant.id }))).error?.code).toBe('CONFLICT');
    expect((await listUnitBeds(org.id, unit.id))[0].tenantName).toBe('Tenant One');

    expect((await actions.assignUnitBed({}, formOf({ id: bedA.id, tenant_id: '' }))).error).toBeUndefined();
    expect((await listUnitBeds(org.id, unit.id))[0].tenantId).toBeNull();
  });

  it('rejects tenants and beds from another org', async () => {
    const other = await seedOrg(smoke.db);
    const foreignTenant = await seedTenant(other.id, 'Foreign');
    const foreignUnit = await seedUnit(other.id);
    const [foreignBed] = await smoke.db.insert(schema.unitBeds)
      .values({ orgId: other.id, unitId: foreignUnit.id, label: 'X' }).returning();

    const org = await signIn();
    const unit = await seedUnit(org.id);
    await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'A' }));
    const [bed] = await listUnitBeds(org.id, unit.id);

    expect((await actions.assignUnitBed({}, formOf({ id: bed.id, tenant_id: foreignTenant.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.assignUnitBed({}, formOf({ id: foreignBed.id, tenant_id: '' }))).error?.code).toBe('NOT_FOUND');
  });
});

describe('removeUnitBed', () => {
  it('deletes own beds only and cascades with the unit', async () => {
    const other = await seedOrg(smoke.db);
    const foreignUnit = await seedUnit(other.id);
    const [foreignBed] = await smoke.db.insert(schema.unitBeds)
      .values({ orgId: other.id, unitId: foreignUnit.id, label: 'X' }).returning();

    const org = await signIn();
    const unit = await seedUnit(org.id);
    await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'A' }));
    await actions.createUnitBed({}, formOf({ unit_id: unit.id, label: 'B' }));
    const [bed] = await listUnitBeds(org.id, unit.id);

    expect((await actions.removeUnitBed({}, formOf({ id: foreignBed.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.removeUnitBed({}, formOf({ id: bed.id }))).error).toBeUndefined();
    expect(await listUnitBeds(org.id, unit.id)).toHaveLength(1);

    await smoke.db.delete(schema.units).where(eq(schema.units.id, unit.id));
    expect(await smoke.db.select().from(schema.unitBeds).where(eq(schema.unitBeds.unitId, unit.id))).toHaveLength(0);
  });
});
