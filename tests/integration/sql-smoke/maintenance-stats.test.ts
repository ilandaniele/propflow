import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const { loadMaintenanceStats } = await import('@/lib/incidents/stats');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 1, 9);
const after = (days: number) => new Date(T0.getTime() + days * DAY);

describe('loadMaintenanceStats', () => {
  it('aggregates per property and category, scoped to the org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const tower = await seedProperty(db, org.id, { name: 'Torre' });
    const house = await seedProperty(db, org.id, { name: 'Casa' });
    const foreign = await seedProperty(db, other.id, { name: 'Ajena' });
    const base = { description: 'x', title: 'x', createdAt: T0 };

    await db.insert(schema.incidents).values([
      { ...base, orgId: org.id, propertyId: tower.id, category: 'plumbing', status: 'solved', resolvedAt: after(2) },
      { ...base, orgId: org.id, propertyId: tower.id, category: 'plumbing', status: 'solved', resolvedAt: after(4) },
      { ...base, orgId: org.id, propertyId: tower.id, category: 'electrical', status: 'pending' },
      { ...base, orgId: org.id, propertyId: house.id, category: 'other', status: 'in_progress' },
      { ...base, orgId: org.id, propertyId: house.id, category: 'other', status: 'solved' },
      { ...base, orgId: org.id, propertyId: null, category: 'other', status: 'pending' },
      { ...base, orgId: other.id, propertyId: foreign.id, category: 'plumbing', status: 'solved', resolvedAt: after(100) },
    ]);

    const stats = await loadMaintenanceStats(org.id);

    expect(stats).toMatchObject({ total: 6, open: 3, solved: 3, avgResolutionDays: 3 });
    const byName = Object.fromEntries(stats.byProperty.map((p) => [p.propertyName ?? 'none', p]));
    expect(byName.Torre).toMatchObject({ total: 3, open: 1, avgResolutionDays: 3 });
    expect(byName.Casa).toMatchObject({ total: 2, open: 1, avgResolutionDays: null });
    expect(byName.none).toMatchObject({ total: 1, open: 1 });
    expect(byName.Ajena).toBeUndefined();
    expect(stats.byCategory).toEqual([
      { category: 'other', total: 3 },
      { category: 'plumbing', total: 2 },
      { category: 'electrical', total: 1 },
    ]);
  });

  it('returns empty stats for an org without incidents', async () => {
    const org = await seedOrg(smoke.db);
    expect(await loadMaintenanceStats(org.id)).toMatchObject({ total: 0, avgResolutionDays: null, byProperty: [] });
  });
});
