import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { generateRentCharges } from '@/lib/finance/generate-rent-charges';
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

async function seedContract(orgId: string, status: string) {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: 'A-1', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-15',
    monthlyRent: '850.00', status, createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

describe('generateRentCharges (real SQL)', () => {
  it('creates one rent charge per active contract and is idempotent', async () => {
    const org = await seedOrg(db);
    const active = await seedContract(org.id, 'active');
    await seedContract(org.id, 'terminated');
    await db.insert(schema.charges).values({
      id: crypto.randomUUID(), orgId: org.id, contractId: active.id, tenantId: active.tenantId,
      period: '2026-11-01', description: 'Sanción', amount: '50', createdAt: now(), updatedAt: now(),
    });

    expect(await generateRentCharges('2026-11-22')).toBe(1);
    expect(await generateRentCharges('2026-11-23')).toBe(0);

    const rows = await db.select().from(schema.charges).where(eq(schema.charges.orgId, org.id));
    const rent = rows.filter((row) => row.kind === 'rent');
    expect(rows).toHaveLength(2);
    expect(rent).toMatchObject([{ contractId: active.id, period: '2026-11-01', dueDate: '2026-11-15', amount: '850.00' }]);
  });
});
