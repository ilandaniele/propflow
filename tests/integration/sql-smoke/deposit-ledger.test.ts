import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin', profile: { id: '' } } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveDepositMovement } from '@/app/actions/deposits';

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

async function seedContract(orgId: string) {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: '101', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant One', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01',
    monthlyRent: '850.00', deposit: '1700.00', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  return contract;
}

async function signInAdmin(orgId: string) {
  const profile = await seedProfile(db, orgId);
  auth.ctx = { userId: profile.id, orgId, role: 'admin', profile: { id: profile.id } };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const move = (contractId: string, kind: string, amount: string) =>
  saveDepositMovement(null, form({ contract_id: contractId, kind, amount, moved_on: '2026-11-20', description: 'test' }));

describe('saveDepositMovement (real SQL)', () => {
  it('records collection, deduction and refund, keeping deposit_returned in sync', async () => {
    const org = await seedOrg(db);
    await signInAdmin(org.id);
    const contract = await seedContract(org.id);

    expect((await move(contract.id, 'collected', '1700')).error).toBeUndefined();
    expect((await move(contract.id, 'deduction', '300.50')).error).toBeUndefined();
    expect((await move(contract.id, 'refund', '1399.50')).error).toBeUndefined();

    const rows = await db.select().from(schema.depositMovements).where(eq(schema.depositMovements.contractId, contract.id));
    expect(rows.map((r) => [r.kind, r.amount]).sort()).toEqual([
      ['collected', '1700.00'], ['deduction', '300.50'], ['refund', '1399.50'],
    ]);
    const [updated] = await db.select({ returned: schema.contracts.depositReturned }).from(schema.contracts)
      .where(eq(schema.contracts.id, contract.id));
    expect(Number(updated.returned)).toBe(1399.5);
  });

  it('rejects a deduction above the deposit held', async () => {
    const org = await seedOrg(db);
    await signInAdmin(org.id);
    const contract = await seedContract(org.id);
    await move(contract.id, 'collected', '500');

    expect((await move(contract.id, 'deduction', '500.01')).error?.code).toBe('EXCEEDS_BALANCE');
    expect((await move(contract.id, 'refund', '600')).error?.code).toBe('EXCEEDS_BALANCE');
  });

  it('refuses a contract from another org', async () => {
    const org = await seedOrg(db);
    const other = await seedOrg(db);
    const foreign = await seedContract(other.id);
    await signInAdmin(org.id);

    expect((await move(foreign.id, 'collected', '100')).error?.code).toBe('NOT_FOUND');
  });

  it('validates the input', async () => {
    const org = await seedOrg(db);
    await signInAdmin(org.id);
    const contract = await seedContract(org.id);

    expect((await move(contract.id, 'collected', '-5')).error?.code).toBe('VALIDATION_ERROR');
    expect((await move(contract.id, 'bonus', '5')).error?.code).toBe('VALIDATION_ERROR');
    expect((await move('nope', 'collected', '5')).error?.code).toBe('VALIDATION_ERROR');
  });
});
