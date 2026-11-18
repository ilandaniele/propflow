/**
 * Real-SQL smoke test for getTenantStatement (src/lib/dashboard/queries.ts) on
 * local D1 (W-CF-38): the tenant_statement read behind /portal and the tenant
 * detail PortalHomeSection / PaymentsTab. Two orgs are seeded to prove the
 * read is scoped by org_id.
 */

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

async function seedTenant(
  db: SmokeDb,
  charges: Array<{ amount: string; dueDate: string | null }>,
  payments: Array<{ amount: string; status: string }>,
) {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id);
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'P1' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Portal Tenant', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '800.00' })
    .returning();
  const owned = { orgId: org.id, contractId: contract.id, tenantId: tenant.id };
  if (charges.length) await db.insert(schema.charges).values(charges.map((c) => ({ ...owned, ...c })));
  if (payments.length) await db.insert(schema.payments).values(payments.map((p) => ({ ...owned, ...p, paidAt: '2026-11-05' })));
  return { orgId: org.id, tenantId: tenant.id };
}

describe('getTenantStatement (real SQL)', () => {
  it('counts only approved payments and flags a past-due debt as overdue', async () => {
    const { getTenantStatement } = await import('@/lib/dashboard/queries');
    const a = await seedTenant(smoke.db, [{ amount: '800.00', dueDate: '2020-01-05' }], [
      { amount: '300.00', status: 'approved' },
      { amount: '500.00', status: 'rejected' },
      { amount: '100.00', status: 'pending' },
    ]);

    expect(await getTenantStatement(a.orgId, a.tenantId)).toEqual({
      total_charges: 800,
      total_approved_payments: 300,
      balance: -500,
      is_overdue: true,
    });
  });

  it('does not flag a debt whose charges are not yet due, and reports credit as a positive balance', async () => {
    const { getTenantStatement } = await import('@/lib/dashboard/queries');
    const notDue = await seedTenant(smoke.db, [{ amount: '800.00', dueDate: '2999-01-05' }, { amount: '50.00', dueDate: null }], []);
    const credit = await seedTenant(smoke.db, [{ amount: '800.00', dueDate: '2020-01-05' }], [{ amount: '900.00', status: 'approved' }]);

    expect(await getTenantStatement(notDue.orgId, notDue.tenantId)).toMatchObject({ balance: -850, is_overdue: false });
    expect(await getTenantStatement(credit.orgId, credit.tenantId)).toMatchObject({ balance: 100, is_overdue: false });
  });

  it("returns null for another org's tenant or an unknown tenant", async () => {
    const { getTenantStatement } = await import('@/lib/dashboard/queries');
    const a = await seedTenant(smoke.db, [{ amount: '800.00', dueDate: '2020-01-05' }], []);
    const b = await seedTenant(smoke.db, [{ amount: '999.00', dueDate: '2020-01-05' }], []);

    expect(await getTenantStatement(a.orgId, b.tenantId)).toBeNull();
    expect(await getTenantStatement(b.orgId, a.tenantId)).toBeNull();
    expect(await getTenantStatement(a.orgId, crypto.randomUUID())).toBeNull();
    expect((await getTenantStatement(b.orgId, b.tenantId))?.total_charges).toBe(999);
  });
});
