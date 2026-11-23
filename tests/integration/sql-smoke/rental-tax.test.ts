import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

import { rentalIncomeByMonth } from '@/lib/finance/rental-tax-query';

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedRentOrg(db: SmokeDb, scale: number) {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id, { name: `Torre ${scale}` });
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'A1', status: 'occupied' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Renter', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '1000.00' })
    .returning();
  const base = { orgId: org.id, contractId: contract.id, tenantId: tenant.id };
  await db.insert(schema.payments).values([
    { ...base, amount: String(1000 * scale), paidAt: '2026-01-05', status: 'approved' },
    { ...base, amount: String(250.5 * scale), paidAt: '2026-01-20', status: 'approved', movementType: 'partial_payment' },
    { ...base, amount: String(300 * scale), paidAt: '2026-02-03', status: 'approved', currency: 'USD' },
    { ...base, amount: String(900 * scale), paidAt: '2026-03-01', status: 'pending' },
    { ...base, amount: String(2000 * scale), paidAt: '2026-03-02', status: 'approved', movementType: 'deposit' },
    { ...base, amount: String(700 * scale), paidAt: '2025-12-31', status: 'approved' },
    { ...base, amount: String(800 * scale), paidAt: '2027-01-01', status: 'approved' },
  ]);
  return { org, property };
}

describe('rentalIncomeByMonth', () => {
  it('sums approved rent per property, month and currency, scoped to org and year', async () => {
    const { org, property } = await seedRentOrg(smoke.db, 1);
    await seedRentOrg(smoke.db, 1000);

    const rows = await rentalIncomeByMonth(org.id, 2026);
    const sorted = [...rows].sort((a, b) => a.month - b.month);

    expect(sorted).toEqual([
      { propertyId: property.id, propertyName: 'Torre 1', currency: 'PEN', month: 1, amount: 1250.5 },
      { propertyId: property.id, propertyName: 'Torre 1', currency: 'USD', month: 2, amount: 300 },
    ]);
  });

  it('returns nothing for a year without payments', async () => {
    const { org } = await seedRentOrg(smoke.db, 1);
    expect(await rentalIncomeByMonth(org.id, 2024)).toEqual([]);
  });
});
