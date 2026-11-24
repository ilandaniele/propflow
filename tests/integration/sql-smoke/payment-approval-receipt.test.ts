import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const state = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' }, scheduled: [] as Promise<unknown>[] }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => state.ctx), requireUser: vi.fn(async () => state.ctx) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'cf-ray': 'ray-smoke' }) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (run: () => Promise<unknown>) => { state.scheduled.push(run()); },
}));
vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

import { sendEmail } from '@/lib/notifications/email';
import { approvePayment } from '@/app/actions/payments';
import { PATCH } from '@/app/api/admin/payments/[paymentId]/approve/route';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  vi.mocked(sendEmail).mockClear();
  state.scheduled = [];
});

const now = () => new Date();

async function seedPendingPayment(email: string | null) {
  const org = await seedOrg(db, { name: 'Acme Rentas' });
  const [admin, tenantProfile] = await db.insert(schema.profiles).values([
    { id: crypto.randomUUID(), orgId: org.id, role: 'admin', createdAt: now(), updatedAt: now() },
    { id: crypto.randomUUID(), orgId: org.id, role: 'tenant', createdAt: now(), updatedAt: now() },
  ]).returning();
  const [tenant] = await db.insert(schema.tenants).values({
    id: crypto.randomUUID(), orgId: org.id, fullName: 'Tenant One', email, profileId: tenantProfile.id, createdAt: now(), updatedAt: now(),
  }).returning();
  const property = await seedProperty(db, org.id);
  const [unit] = await db.insert(schema.units).values({
    id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label: '301', createdAt: now(), updatedAt: now(),
  }).returning();
  const [contract] = await db.insert(schema.contracts).values({
    id: crypto.randomUUID(), orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01',
    monthlyRent: '850.00', status: 'active', createdAt: now(), updatedAt: now(),
  }).returning();
  const [payment] = await db.insert(schema.payments).values({
    id: crypto.randomUUID(), orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '850.00',
    paidAt: '2026-11-05', status: 'pending', createdAt: now(), updatedAt: now(),
  }).returning();
  state.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
  return { payment, tenantProfile };
}

function approveForm(paymentId: string) {
  const form = new FormData();
  form.set('payment_id', paymentId);
  return form;
}

async function settle() {
  await Promise.all(state.scheduled);
}

async function inboxFor(profileId: string) {
  return db.select().from(schema.notificationInbox).where(eq(schema.notificationInbox.profileId, profileId));
}

describe('payment approval receipt notice (real SQL)', () => {
  it('approves once, emails the tenant once and writes one inbox entry', async () => {
    const { payment, tenantProfile } = await seedPendingPayment('tenant@example.com');

    expect((await approvePayment({}, approveForm(payment.id))).error).toBeUndefined();
    expect((await approvePayment({}, approveForm(payment.id))).error?.code).toBe('CONFLICT');
    await settle();

    const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(row.status).toBe('approved');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: 'tenant@example.com', subject: `Tu constancia de pago REC-${payment.id.slice(0, 8).toUpperCase()}` });
    expect(await inboxFor(tenantProfile.id)).toEqual([
      expect.objectContaining({ type: 'payment_receipt', relatedType: 'payment', relatedId: payment.id }),
    ]);
  });

  it('PATCH route re-approval does not send twice', async () => {
    const { payment } = await seedPendingPayment('tenant@example.com');
    const patch = () => PATCH(new NextRequest('http://localhost/api'), { params: Promise.resolve({ paymentId: payment.id }) });

    expect((await patch()).status).toBe(200);
    expect((await patch()).status).toBe(200);
    await settle();

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips the email for a tenant without email but still notifies the inbox', async () => {
    const { payment, tenantProfile } = await seedPendingPayment(null);

    expect((await approvePayment({}, approveForm(payment.id))).error).toBeUndefined();
    await settle();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(await inboxFor(tenantProfile.id)).toHaveLength(1);
  });
});
