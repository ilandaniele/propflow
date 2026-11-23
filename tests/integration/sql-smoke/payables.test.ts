import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProperty, type SmokeHandle } from './setup';
import * as schema from '@/lib/db/schema';

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
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TODAY = '2026-11-23';

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function actions() {
  return import('@/app/actions/payables');
}

async function queries() {
  return import('@/lib/finance/payables/queries');
}

async function createPayableFor(orgId: string, overrides: Record<string, string> = {}) {
  const { createPayable } = await actions();
  auth.orgId = orgId;
  const result = await createPayable({}, form({
    supplier_name: 'Ferretería Lima',
    description: 'Pintura',
    document_ref: 'F001-1',
    amount: '100.00',
    issued_on: '2026-11-01',
    due_on: '2026-12-15',
    ...overrides,
  }));
  expect(result.error).toBeUndefined();
  const [row] = await smoke.db.select({ id: schema.payables.id })
    .from(schema.payables)
    .where(and(eq(schema.payables.orgId, orgId), eq(schema.payables.documentRef, overrides.document_ref ?? 'F001-1')));
  return row.id;
}

async function pay(payableId: string, amount: string) {
  const { registerPayablePayment } = await actions();
  return registerPayablePayment({}, form({ payable_id: payableId, amount, paid_on: '2026-11-20', note: '' }));
}

describe('payables (real SQL)', () => {
  it('aggregates saldo from payments and moves partial to paid', async () => {
    const { listPayables } = await queries();
    const org = await seedOrg(smoke.db);
    auth.fail = false;
    const payableId = await createPayableFor(org.id);

    let page = await listPayables(org.id, { page: 1 }, TODAY);
    expect(page.items[0]).toMatchObject({ id: payableId, amountCents: 10000, paidCents: 0, saldoCents: 10000, status: 'pending' });

    expect((await pay(payableId, '33.33')).error).toBeUndefined();
    expect((await pay(payableId, '33.33')).error).toBeUndefined();
    page = await listPayables(org.id, { page: 1 }, TODAY);
    expect(page.items[0]).toMatchObject({ paidCents: 6666, saldoCents: 3334, status: 'partial' });

    expect((await pay(payableId, '33.34')).error).toBeUndefined();
    page = await listPayables(org.id, { page: 1 }, TODAY);
    expect(page.items[0]).toMatchObject({ paidCents: 10000, saldoCents: 0, status: 'paid' });
    expect(page.total).toBe(1);
  });

  it('rejects a payment larger than the saldo in the action and in SQL', async () => {
    const org = await seedOrg(smoke.db);
    auth.fail = false;
    const payableId = await createPayableFor(org.id);
    expect((await pay(payableId, '60')).error).toBeUndefined();

    const over = await pay(payableId, '40.01');
    expect(over.error?.code).toBe('VALIDATION_ERROR');

    await expect(smoke.db.insert(schema.payablePayments).values({
      payableId, orgId: org.id, amount: '40.01', paidOn: '2026-11-21',
    })).rejects.toThrow();
    await expect(smoke.db.insert(schema.payablePayments).values({
      payableId, orgId: org.id, amount: '0', paidOn: '2026-11-21',
    })).rejects.toThrow();

    const payments = await smoke.db.select().from(schema.payablePayments).where(eq(schema.payablePayments.payableId, payableId));
    expect(payments).toHaveLength(1);
  });

  it('flags overdue balances, filters by status and due range, and totals pending and overdue', async () => {
    const { listPayables, payablesSummary } = await queries();
    const org = await seedOrg(smoke.db);
    auth.fail = false;
    const overdueId = await createPayableFor(org.id, { document_ref: 'OVR', due_on: '2026-11-10', amount: '200' });
    const partialOverdueId = await createPayableFor(org.id, { document_ref: 'POV', due_on: '2026-11-15', amount: '50' });
    await createPayableFor(org.id, { document_ref: 'FUT', due_on: '2026-12-20', amount: '300' });
    const paidPastId = await createPayableFor(org.id, { document_ref: 'PAID', due_on: '2026-11-01', amount: '80' });
    await pay(partialOverdueId, '20');
    await pay(paidPastId, '80');

    const overdue = await listPayables(org.id, { page: 1, status: 'overdue' }, TODAY);
    expect(overdue.items.map((i) => i.id).sort()).toEqual([overdueId, partialOverdueId].sort());
    expect(overdue.items.every((i) => i.status === 'overdue')).toBe(true);

    const paid = await listPayables(org.id, { page: 1, status: 'paid' }, TODAY);
    expect(paid.items.map((i) => i.id)).toEqual([paidPastId]);

    const ranged = await listPayables(org.id, { page: 1, due_from: '2026-11-12', due_to: '2026-11-30' }, TODAY);
    expect(ranged.items.map((i) => i.id)).toEqual([partialOverdueId]);

    const summary = await payablesSummary(org.id, TODAY);
    expect(summary).toEqual({ pendingCents: 20000 + 3000 + 30000, overdueCents: 20000 + 3000 });
  });

  it('paginates with a capped page size', async () => {
    const { listPayables, PAYABLES_PAGE_SIZE } = await queries();
    const org = await seedOrg(smoke.db);
    const rows = Array.from({ length: PAYABLES_PAGE_SIZE + 2 }, (_, i) => ({
      orgId: org.id,
      supplierName: `Supplier ${i}`,
      amount: '10',
      issuedOn: '2026-11-01',
      dueOn: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    for (const row of rows) await smoke.db.insert(schema.payables).values(row);

    const first = await listPayables(org.id, { page: 1 }, TODAY);
    const second = await listPayables(org.id, { page: 2 }, TODAY);
    expect(first.items).toHaveLength(PAYABLES_PAGE_SIZE);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(PAYABLES_PAGE_SIZE + 2);
  });

  it('isolates organizations', async () => {
    const { listPayables, payablesSummary } = await queries();
    const mine = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    auth.fail = false;
    const otherPayable = await createPayableFor(other.id);

    auth.orgId = mine.id;
    expect((await pay(otherPayable, '10')).error?.code).toBe('NOT_FOUND');
    expect((await listPayables(mine.id, { page: 1 }, TODAY)).items).toHaveLength(0);
    expect(await payablesSummary(mine.id, TODAY)).toEqual({ pendingCents: 0, overdueCents: 0 });

    const otherProperty = await seedProperty(smoke.db, other.id);
    const { createPayable } = await actions();
    const foreign = await createPayable({}, form({
      supplier_name: 'X', amount: '10', issued_on: '2026-11-01', due_on: '2026-11-30', property_id: otherProperty.id,
    }));
    expect(foreign.error?.code).toBe('NOT_FOUND');
  });

  it('requires an admin and valid input', async () => {
    const { createPayable } = await actions();
    const org = await seedOrg(smoke.db);
    auth.orgId = org.id;
    auth.fail = false;
    const invalid = await createPayable({}, form({ supplier_name: '', amount: '10', issued_on: '2026-11-01', due_on: '2026-11-30' }));
    expect(invalid.error?.code).toBe('VALIDATION_ERROR');

    auth.fail = true;
    expect((await createPayable({}, form({ supplier_name: 'X', amount: '10', issued_on: '2026-11-01', due_on: '2026-11-30' }))).error?.code).toBe('UNAUTHORIZED');
    expect((await pay('11111111-1111-4111-8111-111111111111', '1')).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
