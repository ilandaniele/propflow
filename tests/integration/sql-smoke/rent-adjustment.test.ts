import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: 'admin-1', orgId: '', role: 'admin', profile: { id: '' } } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { adjustRent } from '@/app/actions/rent-adjustments';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const now = () => new Date();

async function signIn() {
  const org = await seedOrg(db);
  const profile = await seedProfile(db, org.id);
  auth.ctx.orgId = org.id;
  auth.ctx.profile.id = profile.id;
  return org;
}

async function seedContract(orgId: string, status = 'active') {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: '101', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant One', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2025-12-01',
    monthlyRent: '850.00', status, createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('adjustRent (real SQL)', () => {
  it('updates the rent and records history', async () => {
    const org = await signIn();
    const contract = await seedContract(org.id);

    const result = await adjustRent(null, form({ contract_id: contract.id, percent: '5', effective_on: '2026-12-01' }));
    expect(result.error).toBeUndefined();
    expect(Number(result.data?.newRent)).toBe(892.5);

    const [updated] = await db.select({ rent: schema.contracts.monthlyRent }).from(schema.contracts)
      .where(eq(schema.contracts.id, contract.id));
    expect(Number(updated.rent)).toBe(892.5);

    const history = await db.select().from(schema.rentAdjustments)
      .where(eq(schema.rentAdjustments.contractId, contract.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ orgId: org.id, effectiveOn: '2026-12-01', createdBy: auth.ctx.profile.id });
    expect(Number(history[0].previousRent)).toBe(850);
    expect(Number(history[0].newRent)).toBe(892.5);
  });

  it('refuses inactive contracts', async () => {
    const org = await signIn();
    const contract = await seedContract(org.id, 'expired');

    const result = await adjustRent(null, form({ contract_id: contract.id, percent: '5', effective_on: '2026-12-01' }));
    expect(result.error?.code).toBe('NOT_ACTIVE');
  });

  it('refuses contracts from another org', async () => {
    const other = await seedOrg(db);
    const contract = await seedContract(other.id);
    await signIn();

    const result = await adjustRent(null, form({ contract_id: contract.id, percent: '5', effective_on: '2026-12-01' }));
    expect(result.error?.code).toBe('NOT_FOUND');
    const [unchanged] = await db.select({ rent: schema.contracts.monthlyRent }).from(schema.contracts)
      .where(eq(schema.contracts.id, contract.id));
    expect(unchanged.rent).toBe('850.00');
  });

  it('rejects a zero or out-of-range percent', async () => {
    const org = await signIn();
    const contract = await seedContract(org.id);

    for (const percent of ['0', '150', '-60']) {
      const result = await adjustRent(null, form({ contract_id: contract.id, percent, effective_on: '2026-12-01' }));
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    }
  });
});
