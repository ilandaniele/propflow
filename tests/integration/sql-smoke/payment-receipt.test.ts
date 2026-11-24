import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireUser: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

import { getPaymentReceipt } from '@/app/actions/payment-receipt';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const now = () => new Date();

async function seedPayment(orgId: string, status: string, profileId: string | null = null) {
  const property = await seedProperty(db, orgId, { name: 'Torre Sol' });
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: '301', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant One', profileId, createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01',
    monthlyRent: '850.00', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  const [payment] = await db.insert(schema.payments).values({
    id: crypto.randomUUID(), orgId, contractId: contract.id, tenantId: tenant.id, amount: '850.00',
    paidAt: '2026-11-05', status, periodMonth: '2026-11', reference: 'OP-1', createdAt: now(), updatedAt: now(),
  }).returning();
  return payment;
}

function as(role: string, orgId: string, userId = 'user-1') {
  auth.ctx = { userId, orgId, role };
}

describe('getPaymentReceipt (real SQL)', () => {
  it('returns the receipt DTO of an approved payment to an admin', async () => {
    const org = await seedOrg(db, { name: 'Acme Rentas' });
    const payment = await seedPayment(org.id, 'approved');
    as('admin', org.id);

    const result = await getPaymentReceipt(payment.id);

    expect(result.data).toEqual({
      number: `REC-${payment.id.slice(0, 8).toUpperCase()}`,
      orgName: 'Acme Rentas', tenantName: 'Tenant One', propertyName: 'Torre Sol', unitLabel: '301',
      amount: '850.00', currency: 'PEN', paidAt: '2026-11-05', method: 'transfer', concept: '2026-11', reference: 'OP-1',
    });
  });

  it('refuses pending payments and other orgs', async () => {
    const org = await seedOrg(db);
    const other = await seedOrg(db);
    const pending = await seedPayment(org.id, 'pending');
    const foreign = await seedPayment(other.id, 'approved');
    as('admin', org.id);

    expect((await getPaymentReceipt(pending.id)).error?.code).toBe('NOT_FOUND');
    expect((await getPaymentReceipt(foreign.id)).error?.code).toBe('NOT_FOUND');
  });

  it('lets a tenant download only their own receipts', async () => {
    const org = await seedOrg(db);
    const profile = await db.insert(schema.profiles).values({
      id: crypto.randomUUID(), orgId: org.id, role: 'tenant', createdAt: now(), updatedAt: now(),
    }).returning();
    const own = await seedPayment(org.id, 'approved', profile[0].id);
    const someoneElse = await seedPayment(org.id, 'approved');
    as('tenant', org.id, profile[0].id);

    expect((await getPaymentReceipt(own.id)).data?.tenantName).toBe('Tenant One');
    expect((await getPaymentReceipt(someoneElse.id)).error?.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id', async () => {
    as('admin', (await seedOrg(db)).id);
    expect((await getPaymentReceipt('nope')).error?.code).toBe('VALIDATION_ERROR');
  });
});
