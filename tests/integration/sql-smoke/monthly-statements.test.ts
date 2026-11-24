import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { generateStatements } from '@/lib/finance/generate-statements';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const guard = vi.hoisted(() => ({ orgId: '' }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'admin', orgId: guard.orgId })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

import { generateMonthlyStatements } from '@/app/actions/statements';

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

async function seedContract(orgId: string, startDate = '2026-01-15') {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: 'A-1', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate, contractCode: 'C-1',
    monthlyRent: '850.00', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

async function seedCharge(contract: { id: string; orgId: string; tenantId: string }, period: string, amount: string, kind: string | null) {
  await db.insert(schema.charges).values({
    id: crypto.randomUUID(), orgId: contract.orgId, contractId: contract.id, tenantId: contract.tenantId,
    period, description: kind ?? 'Extra', amount, kind, createdAt: now(), updatedAt: now(),
  });
}

async function seedPayment(contract: { id: string; orgId: string; tenantId: string }, amount: string, status: string) {
  await db.insert(schema.payments).values({
    id: crypto.randomUUID(), orgId: contract.orgId, contractId: contract.id, tenantId: contract.tenantId,
    amount, paidAt: '2026-11-05', status, createdAt: now(), updatedAt: now(),
  });
}

const run = (orgId: string) => generateStatements({ orgId, month: '2026-11', issueDate: '2026-11-22', dueDate: '2026-11-30' });

describe('generateStatements (real SQL)', () => {
  it('builds a draft statement from charges and approved payments, idempotently', async () => {
    const org = await seedOrg(db);
    const contract = await seedContract(org.id);
    await seedContract(org.id, '2026-12-01');
    await seedCharge(contract, '2026-10-01', '850.00', 'rent');
    await seedCharge(contract, '2026-10-01', '30.00', null);
    await seedCharge(contract, '2026-11-01', '850.00', 'rent');
    await seedCharge(contract, '2026-11-01', '50.00', null);
    await seedPayment(contract, '900.00', 'approved');
    await seedPayment(contract, '500.00', 'pending');

    expect(await run(org.id)).toEqual({ created: 1, skipped: 0 });
    expect(await run(org.id)).toEqual({ created: 0, skipped: 1 });

    const rows = await db.select().from(schema.accountStatements).where(eq(schema.accountStatements.orgId, org.id));
    expect(rows).toMatchObject([{
      contractId: contract.id, eeccCode: 'EECC-202611-C-1', mes: '11', anio: 2026,
      issueDate: '2026-11-22', dueDate: '2026-11-30', rentAmount: '850.00', additionalSubtotal: '50.00',
      previousRentBalance: '0.00', previousAddlBalance: '0.00', totalDue: '880.00', sendStatus: 'draft',
    }]);
  });

  it('only touches the given org', async () => {
    const orgA = await seedOrg(db);
    const orgB = await seedOrg(db);
    await seedContract(orgB.id);

    expect(await run(orgA.id)).toEqual({ created: 0, skipped: 0 });
    const rows = await db.select().from(schema.accountStatements).where(eq(schema.accountStatements.orgId, orgB.id));
    expect(rows).toHaveLength(0);
  });
});

describe('generateMonthlyStatements action', () => {
  it('rejects an invalid month', async () => {
    const form = new FormData();
    form.set('month', '2026-13');
    form.set('due_date', '2026-11-30');
    const result = await generateMonthlyStatements(null, form);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('generates for the admin org', async () => {
    const org = await seedOrg(db);
    await seedContract(org.id);
    guard.orgId = org.id;
    const form = new FormData();
    form.set('month', '2026-11');
    form.set('due_date', '2026-11-30');
    expect(await generateMonthlyStatements(null, form)).toMatchObject({ data: { created: 1, skipped: 0 } });
  });
});
