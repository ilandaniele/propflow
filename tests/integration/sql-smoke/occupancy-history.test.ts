import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeHandle } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedOrgWithContracts(withExtraUnit: boolean) {
  const db = smoke.db;
  const org = await seedOrg(db);
  const casa = await seedProperty(db, org.id, { name: 'Casa A' });
  const unitValues = [{ orgId: org.id, propertyId: casa.id, label: 'A1', status: 'occupied' }];
  if (withExtraUnit) unitValues.push({ orgId: org.id, propertyId: casa.id, label: 'A2', status: 'vacant' });
  const [unit] = await db.insert(schema.units).values(unitValues).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Tenant' }).returning();
  const base = { orgId: org.id, tenantId: tenant.id, unitId: unit.id, monthlyRent: '1000.00' };
  await db.insert(schema.contracts).values([
    { ...base, startDate: '2026-01-01', endDate: '2026-12-31', actualExitDate: '2026-01-31', status: 'terminated' },
    { ...base, startDate: '2026-03-01', endDate: '2026-03-31', status: 'expired' },
    { ...base, startDate: '2026-05-01', signatureStatus: 'declined' },
    { ...base, startDate: '2024-01-01', endDate: '2024-12-31', status: 'expired' },
  ]);
  return org;
}

describe('occupancy history (real SQL)', () => {
  it('uses actual exit dates, skips declined contracts and isolates orgs', async () => {
    const org = await seedOrgWithContracts(false);
    await seedOrgWithContracts(true);
    const { occupancyHistory } = await import('@/lib/finance/occupancy-history-query');

    const history = await occupancyHistory(org.id, 2026, '2026-12-31');
    expect(history.properties).toHaveLength(1);
    expect(history.properties[0].units).toBe(1);
    expect(history.properties[0].rates.slice(0, 6)).toEqual([1, 0, 1, 0, 0, 0]);
  });
});
