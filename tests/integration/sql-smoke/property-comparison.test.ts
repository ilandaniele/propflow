import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const { compareProperties } = await import('@/lib/properties/comparison');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('compareProperties', () => {
  it('aggregates per property in one query and ignores other orgs', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const alpha = await seedProperty(db, org.id, { name: 'Alpha' });
    const beta = await seedProperty(db, org.id, { name: 'Beta' });
    const foreign = await seedProperty(db, other.id, { name: 'Foreign' });

    const [a1] = await db.insert(schema.units).values([
      { orgId: org.id, propertyId: alpha.id, label: 'A1', status: 'occupied' },
      { orgId: org.id, propertyId: alpha.id, label: 'A2', status: 'vacant' },
    ]).returning();
    const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Ana' }).returning();
    const [contract] = await db.insert(schema.contracts)
      .values({ orgId: org.id, tenantId: tenant.id, unitId: a1.id, startDate: '2026-01-01', monthlyRent: '1000.00' })
      .returning();
    const paid = { orgId: org.id, contractId: contract.id, tenantId: tenant.id };
    await db.insert(schema.payments).values([
      { ...paid, amount: '1000.00', paidAt: '2026-10-05', status: 'approved' },
      { ...paid, amount: '1000.00', paidAt: '2024-10-05', status: 'approved' },
      { ...paid, amount: '500.00', paidAt: '2026-11-05', status: 'pending' },
    ]);
    await db.insert(schema.expenses).values([
      { orgId: org.id, propertyId: alpha.id, amount: '150.50', description: 'Gasfitero', incurredOn: '2026-09-01' },
      { orgId: org.id, propertyId: alpha.id, amount: '999.00', description: 'Viejo', incurredOn: '2024-01-01' },
    ]);
    await db.insert(schema.incidents).values([
      { orgId: org.id, propertyId: alpha.id, title: 'Fuga', description: 'x', category: 'plumbing', status: 'pending' },
      { orgId: org.id, propertyId: alpha.id, title: 'Listo', description: 'x', category: 'plumbing', status: 'solved' },
    ]);

    const rows = await compareProperties(org.id, [beta.id, alpha.id, foreign.id], '2025-12-01');

    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(rows[0]).toMatchObject({
      totalUnits: 2, occupiedUnits: 1, occupancyPct: 50, contractedRent: 1000,
      collected: 1000, expenses: 150.5, net: 849.5, openIncidents: 1,
    });
    expect(rows[1]).toMatchObject({
      totalUnits: 0, occupiedUnits: 0, occupancyPct: 0, contractedRent: 0, collected: 0, expenses: 0, net: 0, openIncidents: 0,
    });
    expect(await compareProperties(org.id, [], '2025-12-01')).toEqual([]);
  });
});
