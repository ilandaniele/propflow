import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { loadAging } from '@/lib/finance/load-aging';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

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

async function seedTenantContract(orgId: string, fullName: string) {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: 'A-1', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName, createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01',
    monthlyRent: '100', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

async function seedCharge(contract: { orgId: string; id: string; tenantId: string }, dueDate: string, amount: string) {
  await db.insert(schema.charges).values({
    id: crypto.randomUUID(), orgId: contract.orgId, contractId: contract.id, tenantId: contract.tenantId,
    period: `${dueDate.slice(0, 7)}-01`, dueDate, description: 'Renta', amount, createdAt: now(), updatedAt: now(),
  });
}

async function seedPayment(contract: { orgId: string; id: string; tenantId: string }, amount: string, status: string) {
  await db.insert(schema.payments).values({
    id: crypto.randomUUID(), orgId: contract.orgId, contractId: contract.id, tenantId: contract.tenantId,
    amount, paidAt: '2026-11-01', status, createdAt: now(), updatedAt: now(),
  });
}

describe('loadAging (real SQL)', () => {
  it('nets approved payments against the oldest overdue charges, scoped to the org', async () => {
    const org = await seedOrg(db);
    const otherOrg = await seedOrg(db);
    const contract = await seedTenantContract(org.id, 'Ana');
    const foreign = await seedTenantContract(otherOrg.id, 'Otro');
    await seedCharge(contract, '2026-07-01', '100');
    await seedCharge(contract, '2026-11-10', '100');
    await seedCharge(contract, '2026-12-10', '100');
    await seedPayment(contract, '60', 'approved');
    await seedPayment(contract, '500', 'pending');
    await seedCharge(foreign, '2026-07-01', '999');

    expect(await loadAging(org.id, '2026-11-22')).toEqual([{
      tenantId: contract.tenantId,
      tenantName: 'Ana',
      buckets: { '0_30': 100, '31_60': 0, '61_90': 0, '90_plus': 40 },
      total: 140,
    }]);
  });
});
