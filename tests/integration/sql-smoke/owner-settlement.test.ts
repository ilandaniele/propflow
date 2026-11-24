import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeHandle } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', fail: false }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.fail) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seedOrgWithOwner(scale: number) {
  const db = smoke.db;
  const org = await seedOrg(db);
  const casa = await seedProperty(db, org.id, { name: 'Casa A' });
  const torre = await seedProperty(db, org.id, { name: 'Torre B' });
  const [owner] = await db.insert(schema.owners).values({ orgId: org.id, name: 'Ana' }).returning();
  const [unitA, unitB] = await db.insert(schema.units)
    .values([
      { orgId: org.id, propertyId: casa.id, label: 'A1', status: 'occupied' },
      { orgId: org.id, propertyId: torre.id, label: 'B1', status: 'occupied' },
    ])
    .returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Tenant' }).returning();
  const [contractA, contractB] = await db.insert(schema.contracts)
    .values([
      { orgId: org.id, tenantId: tenant.id, unitId: unitA.id, startDate: '2026-01-01', monthlyRent: '1000.00' },
      { orgId: org.id, tenantId: tenant.id, unitId: unitB.id, startDate: '2026-01-01', monthlyRent: '500.00' },
    ])
    .returning();
  const onA = { orgId: org.id, contractId: contractA.id, tenantId: tenant.id };
  await db.insert(schema.payments).values([
    { ...onA, amount: String(1000 * scale), paidAt: '2026-03-05', status: 'approved' },
    { ...onA, amount: String(999 * scale), paidAt: '2026-03-06', status: 'pending' },
    { ...onA, amount: String(777 * scale), paidAt: '2026-04-01', status: 'approved' },
    { orgId: org.id, contractId: contractB.id, tenantId: tenant.id, amount: String(500 * scale), paidAt: '2026-03-10', status: 'approved' },
  ]);
  await db.insert(schema.expenses).values([
    { orgId: org.id, propertyId: casa.id, amount: String(150 * scale), description: 'Paint', incurredOn: '2026-03-20' },
  ]);
  return { org, casa, torre, owner };
}

describe('owner settlement (real SQL)', () => {
  it('links properties to owners and settles only linked properties in the month', async () => {
    const { org, casa, owner } = await seedOrgWithOwner(1);
    const other = await seedOrgWithOwner(1000);
    auth.orgId = org.id;
    const { savePropertyOwnerTerms } = await import('@/app/actions/owner-terms');
    const { ownerSettlements } = await import('@/lib/finance/owner-settlement-query');

    expect((await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: owner.id, commission_pct: '5' }))).error).toBeUndefined();
    expect((await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: owner.id, commission_pct: '10' }))).error).toBeUndefined();
    expect((await savePropertyOwnerTerms(null, form({ property_id: other.casa.id, owner_id: owner.id, commission_pct: '10' }))).error?.code).toBe('NOT_FOUND');
    expect((await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: other.owner.id, commission_pct: '10' }))).error?.code).toBe('NOT_FOUND');
    expect((await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: owner.id, commission_pct: '150' }))).error?.code).toBe('VALIDATION_ERROR');

    const [settlement] = await ownerSettlements(org.id, { month: '2026-03' });
    expect(settlement.lines).toEqual([
      { propertyId: casa.id, propertyName: 'Casa A', currency: 'PEN', commissionPct: 10, income: 1000, expenses: 150, commission: 100, net: 750 },
    ]);
    expect(await ownerSettlements(org.id, { month: '2026-03', ownerId: other.owner.id })).toEqual([]);
    expect(await ownerSettlements(other.org.id, { month: '2026-03' })).toEqual([]);
  });

  it('serves the CSV export to admins and rejects bad input', async () => {
    const { org, casa, owner } = await seedOrgWithOwner(1);
    auth.orgId = org.id;
    const { savePropertyOwnerTerms } = await import('@/app/actions/owner-terms');
    await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: owner.id, commission_pct: '10' }));
    const { GET } = await import('@/app/api/admin/reports/owner-settlement/route');
    const { NextRequest } = await import('next/server');

    const response = await GET(new NextRequest('http://localhost/api/admin/reports/owner-settlement?month=2026-03'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('owner-settlement-2026-03.csv');
    expect(await response.text()).toContain('Ana,Casa A,PEN,1000.00,150.00,10.00,100.00,750.00');

    expect((await GET(new NextRequest('http://localhost/api/admin/reports/owner-settlement?month=2026-3'))).status).toBe(400);

    auth.fail = true;
    expect((await GET(new NextRequest('http://localhost/api/admin/reports/owner-settlement?month=2026-03'))).status).toBe(401);
    expect((await savePropertyOwnerTerms(null, form({ property_id: casa.id, owner_id: owner.id, commission_pct: '10' }))).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
