import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

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

const now = () => new Date();

describe('public API (real SQL)', () => {
  it('claims only active keys, stamps last use, and revokes within the org only', async () => {
    const { generateApiKey } = await import('@/lib/api-keys/token');
    const { insertApiKey, claimActiveApiKey, revokeApiKey, listApiKeys } = await import('@/lib/api-keys/queries');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const admin = await seedProfile(smoke.db, org.id, { role: 'admin' });
    const { prefix, keyHash } = generateApiKey();
    const row = await insertApiKey({ orgId: org.id, name: 'Contabilidad', prefix, keyHash, createdBy: admin.id });

    const claimed = await claimActiveApiKey(keyHash);
    expect(claimed).toEqual({ id: row.id, orgId: org.id });
    const [listed] = await listApiKeys(org.id);
    expect(listed.lastUsedAt).toBeInstanceOf(Date);
    expect(listed).not.toHaveProperty('keyHash');

    expect(await revokeApiKey(other.id, row.id)).toBe(false);
    expect(await claimActiveApiKey(keyHash)).not.toBeNull();
    expect(await revokeApiKey(org.id, row.id)).toBe(true);
    expect(await claimActiveApiKey(keyHash)).toBeNull();
    expect(await revokeApiKey(org.id, row.id)).toBe(false);
  });

  it('lists only the key org rows, paginated with a lookahead row and filtered by month', async () => {
    const { listPropertiesForApi, listUnitsForApi, listPaymentsForApi, listTenantsForApi } = await import('@/lib/public-api/queries');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const propertyA = await seedProperty(smoke.db, org.id, { name: 'A' });
    await seedProperty(smoke.db, org.id, { name: 'B' });
    await seedProperty(smoke.db, other.id, { name: 'Ajena' });

    const page = await listPropertiesForApi(org.id, { limit: 1, offset: 0 });
    expect(page).toHaveLength(2);
    expect((await listPropertiesForApi(org.id, { limit: 10, offset: 0 })).map((p) => p.name).sort()).toEqual(['A', 'B']);

    const [unit] = await smoke.db.insert(schema.units).values({
      id: crypto.randomUUID(), orgId: org.id, propertyId: propertyA.id, label: 'A-1', createdAt: now(), updatedAt: now(),
    }).returning();
    const [tenant] = await smoke.db.insert(schema.tenants).values({
      id: crypto.randomUUID(), orgId: org.id, fullName: 'Inquilina', dni: '12345678', createdAt: now(), updatedAt: now(),
    }).returning();
    const [contract] = await smoke.db.insert(schema.contracts).values({
      id: crypto.randomUUID(), orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01',
      monthlyRent: '900.00', status: 'active', createdAt: now(), updatedAt: now(),
    }).returning();
    await smoke.db.insert(schema.payments).values(
      ['2026-10-05', '2026-11-05'].map((paidAt) => ({
        id: crypto.randomUUID(), orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '900.00',
        paidAt, status: 'approved', createdAt: now(), updatedAt: now(),
      })),
    );

    expect(await listUnitsForApi(org.id, { limit: 10, offset: 0 }, { propertyId: propertyA.id })).toHaveLength(1);
    expect(await listUnitsForApi(other.id, { limit: 10, offset: 0 }, {})).toHaveLength(0);

    const [tenantDto] = await listTenantsForApi(org.id, { limit: 10, offset: 0 });
    expect(tenantDto.fullName).toBe('Inquilina');
    expect(tenantDto).not.toHaveProperty('dni');

    const november = await listPaymentsForApi(org.id, { limit: 10, offset: 0 }, { month: '2026-11' });
    expect(november.map((p) => p.paidAt)).toEqual(['2026-11-05']);
    expect(await listPaymentsForApi(other.id, { limit: 10, offset: 0 }, {})).toHaveLength(0);
  });
});
