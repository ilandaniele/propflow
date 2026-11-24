/**
 * Real-SQL smoke test for the payment CSV imports (admin + tenant), the admin
 * tenant search and the finance server actions (W-CF-36). Imports write in
 * chunked multi-row INSERTs inside one D1 batch, so > 100 rows must fit under
 * the 100 bound-parameter limit and a failing row must roll back every row.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({ ...auth.ctx, role: 'admin' })),
  requireTenant: vi.fn(async () => ({ ...auth.ctx, role: 'tenant' })),
  requireUser: vi.fn(async () => auth.ctx),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/storage', () => ({ uploadFile: vi.fn() }));

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

async function seedTenantWithContract(orgId: string, overrides: Partial<typeof schema.tenants.$inferInsert> = {}) {
  const property = await seedProperty(db, orgId);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId, propertyId: property.id, label: 'A-1', createdAt: now(), updatedAt: now(),
  }).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId, fullName: 'Tenant', createdAt: now(), updatedAt: now(), ...overrides,
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2024-01-01',
    monthlyRent: '850.00', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  return { tenant, contract, unit, property };
}

function csvRequest(path: string, header: string, lines: string[]): NextRequest {
  const form = new FormData();
  form.append('file', new File([[header, ...lines].join('\n')], 'payments.csv', { type: 'text/csv' }));
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: form });
}

const paymentsOf = (orgId: string) => db.select().from(schema.payments).where(eq(schema.payments.orgId, orgId));

describe('POST /api/admin/payments/import (real SQL)', () => {
  const header = 'payment_date,amount,currency,status,payment_method,tenant_email,external_payment_id';

  it('imports > 100 rows in one atomic batch and upserts by external_payment_id', async () => {
    const org = await seedOrg(db);
    const admin = await seedProfile(db, org.id, { role: 'admin' });
    const { tenant, contract } = await seedTenantWithContract(org.id, { email: 'ana@example.com' });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    const { POST } = await import('@/app/api/admin/payments/import/route');

    const withIds = Array.from({ length: 80 }, (_, i) => `2024-03-15,850.5,PEN,approved,transfer,ana@example.com,PAY-${i}`);
    const plain = Array.from({ length: 70 }, () => '2024-03-16,100,PEN,pending,cash,ana@example.com,');
    const res = await POST(csvRequest('/api/admin/payments/import', header, [...withIds, ...plain]));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 70, updated: 80, skipped: 0, failed: 0 });
    const rows = await paymentsOf(org.id);
    expect(rows).toHaveLength(150);
    expect(rows.every((r) => r.contractId === contract.id && r.tenantId === tenant.id)).toBe(true);
    expect(rows.find((r) => r.externalPaymentId === 'PAY-0')?.amount).toBe('850.5');

    const again = await POST(csvRequest('/api/admin/payments/import', header, ['2024-03-20,900,PEN,approved,card,ana@example.com,PAY-0']));
    expect(await again.json()).toMatchObject({ updated: 1, failed: 0 });
    const upserted = await db.select().from(schema.payments)
      .where(and(eq(schema.payments.orgId, org.id), eq(schema.payments.externalPaymentId, 'PAY-0')));
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ amount: '900', paidAt: '2024-03-20' });
  });

  it('a failing row rolls back the whole import and marks the log failed', async () => {
    const org = await seedOrg(db);
    const admin = await seedProfile(db, org.id, { role: 'admin' });
    await seedTenantWithContract(org.id, { email: 'ana@example.com' });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    const { POST } = await import('@/app/api/admin/payments/import/route');

    const good = Array.from({ length: 120 }, (_, i) => `2024-03-15,850,PEN,approved,transfer,ana@example.com,OK-${i}`);
    // amount 0 passes the CSV parser but violates payments_amount_check.
    const res = await POST(csvRequest('/api/admin/payments/import', header, [...good, '2024-03-15,0,PEN,approved,transfer,ana@example.com,']));

    const body = await res.json() as { created: number; updated: number; failed: number; import_id: string };
    expect(body).toMatchObject({ created: 0, updated: 0, failed: 121 });
    expect(await paymentsOf(org.id)).toHaveLength(0);
    const [log] = await db.select().from(schema.importLogs).where(eq(schema.importLogs.id, body.import_id));
    expect(log.status).toBe('failed');
  });

  it('skips rows whose tenant has no active contract', async () => {
    const org = await seedOrg(db);
    const admin = await seedProfile(db, org.id, { role: 'admin' });
    await db.insert(schema.tenants).values({
      id: crypto.randomUUID(), orgId: org.id, fullName: 'No Contract', email: 'nc@example.com', createdAt: now(), updatedAt: now(),
    });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    const { POST } = await import('@/app/api/admin/payments/import/route');

    const res = await POST(csvRequest('/api/admin/payments/import', header, ['2024-03-15,850,PEN,approved,transfer,nc@example.com,']));
    expect(await res.json()).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(await paymentsOf(org.id)).toHaveLength(0);
  });
});

describe('POST /api/tenant/payments/import (real SQL)', () => {
  const header = 'payment_date,amount,currency,payment_method,external_payment_id';

  it('imports > 100 rows as under_review against the tenant\'s active contract', async () => {
    const org = await seedOrg(db);
    const profile = await seedProfile(db, org.id, { role: 'tenant' });
    const { tenant, contract } = await seedTenantWithContract(org.id, { profileId: profile.id });
    auth.ctx = { userId: profile.id, orgId: org.id, role: 'tenant' };
    const { POST } = await import('@/app/api/tenant/payments/import/route');

    const lines = Array.from({ length: 130 }, (_, i) => `2024-04-01,500,PEN,transfer,${i % 2 ? `T-${i}` : ''}`);
    const res = await POST(csvRequest('/api/tenant/payments/import', header, lines));

    expect(await res.json()).toMatchObject({ created: 65, updated: 65, skipped: 0, failed: 0 });
    const rows = await paymentsOf(org.id);
    expect(rows).toHaveLength(130);
    expect(rows.every((r) => r.status === 'under_review' && r.contractId === contract.id && r.tenantId === tenant.id)).toBe(true);
  });

  it('a failing row leaves no payment rows', async () => {
    const org = await seedOrg(db);
    const profile = await seedProfile(db, org.id, { role: 'tenant' });
    await seedTenantWithContract(org.id, { profileId: profile.id });
    auth.ctx = { userId: profile.id, orgId: org.id, role: 'tenant' };
    const { POST } = await import('@/app/api/tenant/payments/import/route');

    const lines = [...Array.from({ length: 110 }, () => '2024-04-01,500,PEN,transfer,'), '2024-04-01,0,PEN,transfer,'];
    const res = await POST(csvRequest('/api/tenant/payments/import', header, lines));

    expect(await res.json()).toMatchObject({ created: 0, updated: 0, failed: 111 });
    expect(await paymentsOf(org.id)).toHaveLength(0);
  });
});

describe('GET /api/admin/tenants search (real SQL)', () => {
  it('matches case-insensitively and treats % and _ in the term literally', async () => {
    const org = await seedOrg(db);
    const admin = await seedProfile(db, org.id, { role: 'admin' });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    const names = ['Ana 100% Pago', 'Ana 1000 Pago', 'Luis_Perez', 'LuisXPerez', 'Back\\Slash'];
    for (const fullName of names) {
      await db.insert(schema.tenants).values({ id: crypto.randomUUID(), orgId: org.id, fullName, createdAt: now(), updatedAt: now() });
    }
    const { GET } = await import('@/app/api/admin/tenants/route');
    const search = async (term: string) => {
      const res = await GET(new NextRequest(`http://localhost:3000/api/admin/tenants?search=${encodeURIComponent(term)}`));
      const body = await res.json() as { tenants: Array<{ fullName: string }>; total: number };
      return { names: body.tenants.map((t) => t.fullName).sort(), total: body.total };
    };

    expect(await search('100%')).toEqual({ names: ['Ana 100% Pago'], total: 1 });
    expect(await search('s_p')).toEqual({ names: ['Luis_Perez'], total: 1 });
    expect(await search('k\\s')).toEqual({ names: ['Back\\Slash'], total: 1 });
    expect((await search('ana')).total).toBe(2);
  });
});

describe('finance actions (real SQL)', () => {
  const form = (data: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) fd.append(k, v);
    return fd;
  };

  it('creates categories (duplicate name = CONFLICT), creates and updates an expense, matches a receipt', async () => {
    const org = await seedOrg(db);
    const admin = await seedProfile(db, org.id, { role: 'admin' });
    auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
    const finance = await import('@/app/actions/finance');

    expect(await finance.createExpenseCategory({}, form({ name: 'Agua' }))).toEqual({ data: undefined });
    const dup = await finance.createExpenseCategory({}, form({ name: 'Agua' }));
    expect(dup).toMatchObject({ error: { code: 'CONFLICT' } });

    const [category] = await db.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.orgId, org.id));
    expect(await finance.createExpense({}, form({
      category_id: category.id, amount: '120.75', description: 'Recibo agua', incurred_on: '2024-05-01',
    }))).toEqual({ data: undefined });
    const [expense] = await db.select().from(schema.expenses).where(eq(schema.expenses.orgId, org.id));
    expect(expense).toMatchObject({ amount: '120.75', categoryId: category.id, currency: 'PEN' });

    expect(await finance.updateExpense({}, form({ id: expense.id, amount: '99.9' }))).toEqual({ data: undefined });
    const [updatedExpense] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, expense.id));
    expect(updatedExpense.amount).toBe('99.9');

    expect(await finance.updateExpense({}, form({ id: expense.id, currency: 'USD' }))).toEqual({ data: undefined });
    const [usdExpense] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, expense.id));
    expect(usdExpense).toMatchObject({ currency: 'USD', amount: '99.9' });
    expect(await finance.updateExpense({}, form({ id: expense.id, currency: 'BTC' }))).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const { tenant, contract } = await seedTenantWithContract(org.id);
    const [payment] = await db.insert(schema.payments).values({
      id: crypto.randomUUID(), orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '850.00',
      paidAt: '2024-05-02', createdAt: now(), updatedAt: now(),
    }).returning();
    const [receipt] = await db.insert(schema.receiptUploads).values({
      id: crypto.randomUUID(), orgId: org.id, uploadedBy: admin.id, filePath: `${org.id}/uploads/r.png`, createdAt: now(), updatedAt: now(),
    }).returning();
    expect(await finance.matchReceiptToPayment({}, form({
      receipt_id: receipt.id, payment_id: payment.id,
    }))).toEqual({ data: undefined });
    const [matched] = await db.select().from(schema.receiptUploads).where(eq(schema.receiptUploads.id, receipt.id));
    expect(matched).toMatchObject({ paymentId: payment.id, ocrStatus: 'matched' });
  });
});
