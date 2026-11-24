import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedLedgerOrg(db: SmokeDb) {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id);
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'A1' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Ana Pérez', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '900.00' })
    .returning();
  const [category] = await db.insert(schema.expenseCategories).values({ orgId: org.id, name: 'Mantenimiento' }).returning();
  const owed = { orgId: org.id, contractId: contract.id, tenantId: tenant.id };
  await db.insert(schema.payments).values([
    { ...owed, amount: '900', paidAt: '2026-10-05', status: 'approved', method: 'cash' },
    { ...owed, amount: '100', paidAt: '2026-10-06', status: 'pending' },
    { ...owed, amount: '50', paidAt: '2026-11-01', status: 'approved' },
  ]);
  await db.insert(schema.expenses).values([
    { orgId: org.id, amount: '80', description: 'Gasfitero', incurredOn: '2026-10-02', categoryId: category.id },
    { orgId: org.id, amount: '30', description: 'Otro mes', incurredOn: '2026-09-30' },
  ]);
  return org;
}

describe('accounting journal source (real SQL)', () => {
  it('returns approved payments and expenses of the month only, scoped to the org', async () => {
    const { db } = await import('@/lib/db');
    const typedDb = db as unknown as SmokeDb;
    const { journalSource } = await import('@/lib/accounting/queries');
    const { buildJournal } = await import('@/lib/accounting/journal');

    const orgA = await seedLedgerOrg(typedDb);
    await seedLedgerOrg(typedDb);

    const source = await journalSource(orgA.id, '2026-10');
    expect(source.payments).toHaveLength(1);
    expect(source.payments[0]).toMatchObject({ paidAt: '2026-10-05', method: 'cash', tenantName: 'Ana Pérez' });
    expect(source.expenses).toHaveLength(1);
    expect(source.expenses[0]).toMatchObject({ description: 'Gasfitero', categoryName: 'Mantenimiento' });

    const lines = buildJournal(source.payments, source.expenses);
    expect(lines.map((l) => l.account)).toEqual(['639', '1041', '1011', '7542']);
  });

  it('handles December rollover', async () => {
    const { monthRange } = await import('@/lib/accounting/queries');
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
});
