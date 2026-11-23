import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, seedUnit, seedContract, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function seedBuilding() {
  const org = await seedOrg(db);
  const profile = await seedProfile(db, org.id);
  auth.ctx = { userId: profile.id, orgId: org.id, role: 'admin' };
  const property = await seedProperty(db, org.id);
  const small = await seedUnit(db, org.id, property.id, { label: 'A', areaM2: '10' });
  const large = await seedUnit(db, org.id, property.id, { label: 'B', areaM2: '30' });
  const smallTenant = await seedContract(db, org.id, small.id);
  const largeTenant = await seedContract(db, org.id, large.id);
  await seedContract(db, org.id, large.id, { status: 'terminated', startDate: '2023-01-01', endDate: '2023-12-31' });
  const [service] = await db.insert(schema.servicePayments).values({
    orgId: org.id, propertyId: property.id, serviceType: 'luz', supplyNumber: '123', tope: '100',
    monthlyData: { '2026-03': { amount: 180, eecc: null, receipt_url: null } },
  }).returning();
  return { org, service, smallTenant, largeTenant };
}

const chargesOf = (orgId: string) => db.select().from(schema.charges).where(eq(schema.charges.orgId, orgId));

describe('splitUtilityBill (real SQL)', () => {
  it('charges the excess over the tope by area, once', async () => {
    const { splitUtilityBill } = await import('@/app/actions/utility-split');
    const { org, service, smallTenant, largeTenant } = await seedBuilding();
    const fields = { service_payment_id: service.id, month: '2026-03', method: 'area', due_date: '2026-04-10' };

    expect(await splitUtilityBill({}, form(fields))).toEqual({ data: { created: 2, skipped: 0 } });
    const rows = await chargesOf(org.id);
    const byContract = Object.fromEntries(rows.map((row) => [row.contractId, row]));
    expect(byContract[smallTenant.contract.id]).toMatchObject({ amount: '20.00', period: '2026-03-01', dueDate: '2026-04-10', description: 'Servicio luz #123 2026-03' });
    expect(byContract[largeTenant.contract.id]).toMatchObject({ amount: '60.00', tenantId: largeTenant.tenant.id });

    expect(await splitUtilityBill({}, form(fields))).toEqual({ data: { created: 0, skipped: 2 } });
    expect(await chargesOf(org.id)).toHaveLength(2);
  });

  it('refuses a service from another org', async () => {
    const { splitUtilityBill } = await import('@/app/actions/utility-split');
    const { service } = await seedBuilding();
    const attacker = await seedOrg(db);
    auth.ctx = { userId: (await seedProfile(db, attacker.id)).id, orgId: attacker.id, role: 'admin' };

    const result = await splitUtilityBill({}, form({ service_payment_id: service.id, month: '2026-03', method: 'equal', due_date: '2026-04-10' }));
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(await chargesOf(service.orgId)).toEqual([]);
  });

  it('reports a month without a recorded amount', async () => {
    const { splitUtilityBill } = await import('@/app/actions/utility-split');
    const { org, service } = await seedBuilding();

    const result = await splitUtilityBill({}, form({ service_payment_id: service.id, month: '2026-04', method: 'equal', due_date: '2026-05-10' }));
    expect(result.error?.code).toBe('NO_AMOUNT');
    expect(await chargesOf(org.id)).toEqual([]);
  });

  it('rejects invalid input', async () => {
    const { splitUtilityBill } = await import('@/app/actions/utility-split');
    const result = await splitUtilityBill({}, form({ service_payment_id: 'x', month: '2026-13', method: 'random', due_date: 'tomorrow' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});
