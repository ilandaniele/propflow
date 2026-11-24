import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { loadAverageRent } from '@/lib/reports/average-rent-query';
import { loadManagerPerformance } from '@/lib/reports/manager-performance-query';
import { createSmokeDb, seedContract, seedOrg, seedProfile, seedProperty, seedUnit, type SmokeDb } from './setup';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 24, 12);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('loadAverageRent (real SQL)', () => {
  it('averages active contracts per property, unit type and bedrooms, scoped to the org', async () => {
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const tower = await seedProperty(db, org.id, { name: 'Torre' });
    const house = await seedProperty(db, org.id, { name: 'Casa' });
    const foreign = await seedProperty(db, other.id, { name: 'Ajena' });
    const flat = await seedUnit(db, org.id, tower.id, { label: 'T-1', unitType: 'flat', bedrooms: 2 });
    const room = await seedUnit(db, org.id, tower.id, { label: 'T-2', unitType: 'room', bedrooms: 1 });
    const houseUnit = await seedUnit(db, org.id, house.id, { label: 'C-1', unitType: 'flat', bedrooms: 2 });
    const foreignUnit = await seedUnit(db, other.id, foreign.id, { label: 'X-1' });

    await seedContract(db, org.id, flat.id, { monthlyRent: '1000.00' });
    await seedContract(db, org.id, room.id, { monthlyRent: '500.00' });
    await seedContract(db, org.id, houseUnit.id, { monthlyRent: '1500.00' });
    await seedContract(db, org.id, houseUnit.id, { monthlyRent: '9000.00', status: 'terminated' });
    await seedContract(db, other.id, foreignUnit.id, { monthlyRent: '9999.00' });

    const [pen, ...rest] = await loadAverageRent(org.id);

    expect(rest).toEqual([]);
    expect(pen.currency).toBe('PEN');
    expect(pen.overall).toEqual({ key: null, contracts: 3, average: 1000 });
    expect(pen.byProperty).toEqual([
      { key: house.id, propertyName: 'Casa', contracts: 1, average: 1500 },
      { key: tower.id, propertyName: 'Torre', contracts: 2, average: 750 },
    ]);
    expect(pen.byUnitType).toEqual([
      { key: 'flat', contracts: 2, average: 1250 },
      { key: 'room', contracts: 1, average: 500 },
    ]);
    expect(pen.byBedrooms).toEqual([
      { key: '1', contracts: 1, average: 500 },
      { key: '2', contracts: 2, average: 1250 },
    ]);
  });

  it('returns no sections for an org without active contracts', async () => {
    const org = await seedOrg(db);
    expect(await loadAverageRent(org.id)).toEqual([]);
  });
});

describe('loadManagerPerformance (real SQL)', () => {
  it('counts incidents per admin profile within the period, scoped to the org', async () => {
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const ana = await seedProfile(db, org.id, { fullName: 'Ana', email: 'ana@example.com' });
    const bea = await seedProfile(db, org.id, { fullName: 'Bea', email: 'bea@example.com' });
    const tenant = await seedProfile(db, org.id, { role: 'tenant', fullName: 'Inquilino', email: 'tenant@example.com' });
    const foreign = await seedProfile(db, other.id, { fullName: 'Otro', email: 'otro@example.com' });
    const base = { orgId: org.id, category: 'plumbing', title: 'x', description: 'x', updatedAt: NOW };

    await db.insert(schema.incidents).values([
      { ...base, assignedTo: ana.id, status: 'solved', createdAt: daysAgo(10), resolvedAt: daysAgo(8) },
      { ...base, assignedTo: ana.id, status: 'solved', createdAt: daysAgo(20), resolvedAt: daysAgo(16) },
      { ...base, assignedTo: ana.id, status: 'pending', createdAt: daysAgo(5) },
      { ...base, assignedTo: ana.id, status: 'solved', createdAt: daysAgo(60), resolvedAt: daysAgo(59) },
      { ...base, assignedTo: null, status: 'pending', createdAt: daysAgo(1) },
      { ...base, assignedTo: tenant.id, status: 'pending', createdAt: daysAgo(1) },
      { ...base, orgId: other.id, assignedTo: foreign.id, status: 'pending', createdAt: daysAgo(1) },
    ]);

    const last30 = await loadManagerPerformance(org.id, 30, NOW);
    expect(last30.managers).toEqual([
      { profileId: ana.id, name: 'Ana', assigned: 3, resolved: 2, open: 1, avgResolutionDays: 3 },
      { profileId: bea.id, name: 'Bea', assigned: 0, resolved: 0, open: 0, avgResolutionDays: null },
    ]);
    expect(last30.totals).toEqual({ assigned: 3, resolved: 2, open: 1, avgResolutionDays: 3 });

    const last90 = await loadManagerPerformance(org.id, 90, NOW);
    expect(last90.managers[0]).toMatchObject({ profileId: ana.id, assigned: 4, resolved: 3, avgResolutionDays: 2.3 });
  });
});
