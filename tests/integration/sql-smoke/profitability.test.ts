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

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedOrgWithActivity(scale: number) {
  const db = smoke.db;
  const org = await seedOrg(db);
  const casa = await seedProperty(db, org.id, { name: 'Casa A' });
  const torre = await seedProperty(db, org.id, { name: 'Torre B' });
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
  const onB = { orgId: org.id, contractId: contractB.id, tenantId: tenant.id };
  await db.insert(schema.payments).values([
    { ...onA, amount: String(1000 * scale), paidAt: '2026-02-05', status: 'approved' },
    { ...onA, amount: String(400 * scale), paidAt: '2026-03-05', status: 'approved', movementType: 'partial_payment' },
    { ...onA, amount: String(999 * scale), paidAt: '2026-03-06', status: 'pending' },
    { ...onA, amount: String(888 * scale), paidAt: '2026-04-06', status: 'approved', movementType: 'deposit' },
    { ...onA, amount: String(777 * scale), paidAt: '2025-12-31', status: 'approved' },
    { ...onB, amount: String(500 * scale), paidAt: '2026-06-01', status: 'approved', currency: 'USD' },
  ]);
  await db.insert(schema.expenses).values([
    { orgId: org.id, propertyId: casa.id, amount: String(150 * scale), description: 'Paint', incurredOn: '2026-05-01' },
    { orgId: org.id, propertyId: null, amount: String(20 * scale), description: 'Bank fee', incurredOn: '2026-07-01' },
    { orgId: org.id, propertyId: casa.id, amount: String(999 * scale), description: 'Old', incurredOn: '2027-01-01' },
  ]);
  return { org, casa, torre };
}

describe('profitability report (real SQL)', () => {
  it('aggregates one org per property and currency for the year', async () => {
    const { org, casa } = await seedOrgWithActivity(1);
    await seedOrgWithActivity(1000);
    const { profitabilityReport } = await import('@/lib/finance/profitability-query');

    const report = await profitabilityReport(org.id, { year: 2026 });
    expect(report.lines.map((line) => [line.propertyName, line.currency, line.income, line.expenses, line.net])).toEqual([
      ['Casa A', 'PEN', 1400, 150, 1250],
      ['Torre B', 'USD', 500, 0, 500],
      [null, 'PEN', 0, 20, -20],
    ]);

    const filtered = await profitabilityReport(org.id, { year: 2026, propertyId: casa.id });
    expect(filtered.lines).toHaveLength(1);
    expect(filtered.totals).toEqual({ PEN: { income: 1400, expenses: 150, net: 1250 } });
  });

  it('serves the CSV export to admins and rejects bad input', async () => {
    const { org } = await seedOrgWithActivity(1);
    auth.orgId = org.id;
    const { GET } = await import('@/app/api/admin/reports/profitability/route');
    const { NextRequest } = await import('next/server');

    const response = await GET(new NextRequest('http://localhost/api/admin/reports/profitability?year=2026'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('profitability-2026.csv');
    const body = await response.text();
    expect(body).toContain('Casa A,PEN,1400.00,150.00,1250.00');
    expect(body).toContain('TOTAL,USD,500.00,0.00,500.00');

    expect((await GET(new NextRequest('http://localhost/api/admin/reports/profitability?year=abc'))).status).toBe(400);

    auth.fail = true;
    expect((await GET(new NextRequest('http://localhost/api/admin/reports/profitability?year=2026'))).status).toBe(401);
    auth.fail = false;
  });
});
