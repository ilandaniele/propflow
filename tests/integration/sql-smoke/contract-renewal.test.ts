import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: 'admin-1', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { renewContract } from '@/app/actions/contracts';

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

async function seedContract(orgId: string, status = 'active') {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: '101', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant One', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', endDate: '2026-12-31',
    monthlyRent: '850.00', deposit: '1700.00', status, createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('renewContract (real SQL)', () => {
  it('expires the current contract and creates the next term', async () => {
    const org = await seedOrg(db);
    auth.ctx.orgId = org.id;
    const contract = await seedContract(org.id);

    const result = await renewContract(null, form({ contract_id: contract.id, months: '12', monthly_rent: '900' }));
    expect(result.error).toBeUndefined();

    const rows = await db.select().from(schema.contracts)
      .where(and(eq(schema.contracts.orgId, org.id), eq(schema.contracts.tenantId, contract.tenantId)));
    const old = rows.find((r) => r.id === contract.id);
    const next = rows.find((r) => r.id === result.data?.contractId);
    expect(old?.status).toBe('expired');
    expect(next).toMatchObject({
      status: 'active', unitId: contract.unitId, startDate: '2027-01-01', endDate: '2027-12-31',
      monthlyRent: '900.00', deposit: '1700.00', durationMonths: 12,
    });
  });

  it('keeps the current rent when none is given', async () => {
    const org = await seedOrg(db);
    auth.ctx.orgId = org.id;
    const contract = await seedContract(org.id);

    const result = await renewContract(null, form({ contract_id: contract.id, months: '6', monthly_rent: '' }));
    const [next] = await db.select({ rent: schema.contracts.monthlyRent }).from(schema.contracts)
      .where(eq(schema.contracts.id, result.data!.contractId));
    expect(next.rent).toBe('850.00');
  });

  it('refuses inactive and foreign contracts', async () => {
    const org = await seedOrg(db);
    const other = await seedOrg(db);
    auth.ctx.orgId = org.id;
    const expired = await seedContract(org.id, 'expired');
    const foreign = await seedContract(other.id);

    expect((await renewContract(null, form({ contract_id: expired.id, months: '12' }))).error?.code).toBe('NOT_ACTIVE');
    expect((await renewContract(null, form({ contract_id: foreign.id, months: '12' }))).error?.code).toBe('NOT_FOUND');
  });

  it('validates the input', async () => {
    auth.ctx.orgId = (await seedOrg(db)).id;
    expect((await renewContract(null, form({ contract_id: 'nope', months: '12' }))).error?.code).toBe('VALIDATION_ERROR');
    expect((await renewContract(null, form({ contract_id: crypto.randomUUID(), months: '0' }))).error?.code).toBe('VALIDATION_ERROR');
  });
});
