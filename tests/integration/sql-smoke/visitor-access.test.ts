import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

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

async function seedTenantWithUnit(db: SmokeDb, contractStatus: string) {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id);
  const profile = await seedProfile(db, org.id, { role: 'tenant', email: `t-${crypto.randomUUID()}@example.com` });
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'A1' }).returning();
  const [other] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'B2' }).returning();
  const [tenant] = await db.insert(schema.tenants)
    .values({ orgId: org.id, fullName: 'Tenant', unitId: unit.id, profileId: profile.id }).returning();
  await db.insert(schema.contracts).values({
    orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '800.00', status: contractStatus,
  });
  return { orgId: org.id, profileId: profile.id, tenantId: tenant.id, unitId: unit.id, otherUnitId: other.id };
}

describe('visitor access queries (real SQL)', () => {
  it('finds the active contract unit for a tenant profile only', async () => {
    const { findTenantActiveUnit } = await import('@/lib/visitors/queries');
    const active = await seedTenantWithUnit(smoke.db, 'active');
    const ended = await seedTenantWithUnit(smoke.db, 'terminated');

    expect(await findTenantActiveUnit(active.orgId, active.profileId)).toEqual({ tenantId: active.tenantId, unitId: active.unitId });
    expect(await findTenantActiveUnit(ended.orgId, ended.profileId)).toBeNull();
    expect(await findTenantActiveUnit(ended.orgId, active.profileId)).toBeNull();
  });

  it('filters visitor logs by passphrase and unit inside the org', async () => {
    const { listVisitorLogs } = await import('@/lib/visitors/queries');
    const a = await seedTenantWithUnit(smoke.db, 'active');
    const b = await seedTenantWithUnit(smoke.db, 'active');
    await smoke.db.insert(schema.visitorLogs).values([
      { orgId: a.orgId, createdBy: a.profileId, unitId: a.unitId, visitorName: 'Uno', visitDate: '2026-11-20', passphrase: 'azul42' },
      { orgId: a.orgId, createdBy: a.profileId, unitId: a.otherUnitId, visitorName: 'Dos', visitDate: '2026-11-21' },
      { orgId: b.orgId, createdBy: b.profileId, unitId: b.unitId, visitorName: 'Ajeno', visitDate: '2026-11-21', passphrase: 'azul42' },
    ]);

    const byCode = await listVisitorLogs(a.orgId, { passphrase: 'azul42' });
    expect(byCode.map((v) => [v.visitorName, v.unitLabel])).toEqual([['Uno', 'A1']]);
    expect((await listVisitorLogs(a.orgId, { unitId: a.otherUnitId })).map((v) => v.visitorName)).toEqual(['Dos']);
    expect(await listVisitorLogs(a.orgId)).toHaveLength(2);
  });

  it('lists authorized visitors per unit and deletes only within scope', async () => {
    const q = await import('@/lib/visitors/queries');
    const a = await seedTenantWithUnit(smoke.db, 'active');
    await q.insertAuthorizedVisitor({ orgId: a.orgId, unitId: a.unitId, fullName: 'Niñera' });
    await q.insertAuthorizedVisitor({ orgId: a.orgId, unitId: a.otherUnitId, fullName: 'Chofer' });

    const all = await q.listAuthorizedVisitors(a.orgId);
    expect(all.map((r) => r.fullName)).toEqual(['Niñera', 'Chofer']);
    const own = await q.listAuthorizedVisitors(a.orgId, a.unitId);
    expect(own.map((r) => r.fullName)).toEqual(['Niñera']);

    const chofer = all.find((r) => r.fullName === 'Chofer')!;
    expect(await q.deleteAuthorizedVisitor(a.orgId, chofer.id, a.unitId)).toBe(false);
    expect(await q.deleteAuthorizedVisitor('other-org', chofer.id)).toBe(false);
    expect(await q.deleteAuthorizedVisitor(a.orgId, chofer.id)).toBe(true);
    expect(await q.listAuthorizedVisitors(a.orgId)).toHaveLength(1);
  });

  it('checks unit ownership by org', async () => {
    const { unitBelongsToOrg } = await import('@/lib/visitors/queries');
    const a = await seedTenantWithUnit(smoke.db, 'active');
    const b = await seedTenantWithUnit(smoke.db, 'active');
    expect(await unitBelongsToOrg(a.orgId, a.unitId)).toBe(true);
    expect(await unitBelongsToOrg(a.orgId, b.unitId)).toBe(false);
  });
});
