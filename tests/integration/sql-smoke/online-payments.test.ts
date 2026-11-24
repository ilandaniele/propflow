/**
 * Real-SQL smoke test for online payment links (src/lib/online-payments) on
 * local D1: intent reuse, sandbox payment, idempotent Mercado Pago webhook,
 * cross-org isolation and the public routes' token gate. fetch is stubbed:
 * no real Mercado Pago call is made.
 */

import crypto from 'crypto';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import * as schema from '@/lib/db/schema';
import type { PaymentProviderAdapter } from '@/lib/online-payments/types';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const WEBHOOK_SECRET = 'smoke-webhook-secret';

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedCharge(db: SmokeDb, amount = '800.00') {
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id);
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'P1' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Lucía Torres Ramos', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: amount })
    .returning();
  const [charge] = await db.insert(schema.charges)
    .values({ orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount, dueDate: '2026-12-05', description: 'Alquiler diciembre' })
    .returning();
  return { orgId: org.id, chargeId: charge.id };
}

async function intentByToken(token: string) {
  const [row] = await smoke.db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.token, token));
  return row;
}

const mercadoPagoStub: PaymentProviderAdapter = {
  name: 'mercadopago',
  createCheckout: async () => ({ providerRef: 'pref_smoke', checkoutUrl: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref_smoke' }),
};

function signedWebhook(paymentId: string, secret = WEBHOOK_SECRET) {
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const v1 = crypto.createHmac('sha256', secret).update(`id:${paymentId};request-id:${requestId};ts:${ts};`).digest('hex');
  return new NextRequest(`http://localhost:3000/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: { id: paymentId } }),
  });
}

function stubMercadoPago(payment: Record<string, unknown>) {
  vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'TEST-access-token');
  vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', WEBHOOK_SECRET);
  const fetchMock = vi.fn(async () => Response.json(payment));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function simulateRequest(token: string) {
  return {
    request: new NextRequest(`http://localhost:3000/api/pay/${token}/simulate`, { method: 'POST' }),
    context: { params: Promise.resolve({ token }) },
  };
}

describe('online payment links (real SQL)', () => {
  it('reuses the open pending intent for a charge', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { sandboxAdapter } = await import('@/lib/online-payments/sandbox');
    const { orgId, chargeId } = await seedCharge(smoke.db);

    const first = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter);
    const second = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter);

    expect(first).toMatchObject({ kind: 'ok', reused: false });
    expect(second).toMatchObject({ kind: 'ok', reused: true });
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected ok');
    expect(second.token).toBe(first.token);
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    const rows = await smoke.db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.chargeId, chargeId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', provider: 'sandbox', amount: '800.00', currency: 'PEN' });
  });

  it('expires a stale intent and issues a new one', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { sandboxAdapter } = await import('@/lib/online-payments/sandbox');
    const { orgId, chargeId } = await seedCharge(smoke.db);

    const first = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter, new Date('2026-01-01T00:00:00Z'));
    const second = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter, new Date('2026-02-01T00:00:00Z'));
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected ok');

    expect(second.token).not.toBe(first.token);
    expect((await intentByToken(first.token)).status).toBe('expired');
    expect((await intentByToken(second.token)).status).toBe('pending');
  });

  it('sandbox payment marks the intent paid once and blocks new links', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { sandboxAdapter } = await import('@/lib/online-payments/sandbox');
    const { POST } = await import('@/app/api/pay/[token]/simulate/route');
    const { orgId, chargeId } = await seedCharge(smoke.db);
    const link = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter);
    if (link.kind !== 'ok') throw new Error('expected ok');

    const first = simulateRequest(link.token);
    const res = await POST(first.request, first.context);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`http://localhost:3000/pay/${link.token}`);

    const paid = await intentByToken(link.token);
    expect(paid).toMatchObject({ status: 'paid', amountPaid: '800.00', providerPaymentId: `sandbox_${paid.id}` });
    expect(paid.paidAt).toBeInstanceOf(Date);

    const again = simulateRequest(link.token);
    expect((await POST(again.request, again.context)).status).toBe(303);
    expect((await intentByToken(link.token)).paidAt).toEqual(paid.paidAt);
    expect(await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter)).toEqual({ kind: 'already_paid' });
  });

  it('simulate refuses a Mercado Pago intent', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { simulateSandboxPayment } = await import('@/lib/online-payments/settle');
    const { POST } = await import('@/app/api/pay/[token]/simulate/route');
    const { orgId, chargeId } = await seedCharge(smoke.db);
    const link = await createOrReusePaymentLink(orgId, chargeId, mercadoPagoStub);
    if (link.kind !== 'ok') throw new Error('expected ok');

    expect(await simulateSandboxPayment(link.token)).toBe('not_sandbox');
    const { request, context } = simulateRequest(link.token);
    expect((await POST(request, context)).status).toBe(409);
    expect(await intentByToken(link.token)).toMatchObject({ status: 'pending', checkoutUrl: expect.stringMatching(/^https:\/\//) });
  });

  it('public simulate route returns 404 for malformed and unknown tokens', async () => {
    const { POST } = await import('@/app/api/pay/[token]/simulate/route');
    for (const token of ['not-a-token', 'A'.repeat(64), 'f'.repeat(64)]) {
      const { request, context } = simulateRequest(token);
      expect((await POST(request, context)).status).toBe(404);
    }
  });

  it('public pay lookup returns only the tenant first name', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { sandboxAdapter } = await import('@/lib/online-payments/sandbox');
    const { findPublicIntentByToken } = await import('@/lib/online-payments/queries');
    const { orgId, chargeId } = await seedCharge(smoke.db);
    const link = await createOrReusePaymentLink(orgId, chargeId, sandboxAdapter);
    if (link.kind !== 'ok') throw new Error('expected ok');

    const intent = await findPublicIntentByToken(link.token);
    expect(intent).toMatchObject({ amount: '800.00', concept: 'Alquiler diciembre', dueDate: '2026-12-05', tenantFirstName: 'Lucía' });
    expect(JSON.stringify(intent)).not.toContain('Torres');
    expect(await findPublicIntentByToken('0'.repeat(64))).toBeNull();
  });

  it('Mercado Pago webhook reconciles once and is idempotent', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { POST } = await import('@/app/api/webhooks/mercadopago/route');
    const { orgId, chargeId } = await seedCharge(smoke.db);
    const link = await createOrReusePaymentLink(orgId, chargeId, mercadoPagoStub);
    if (link.kind !== 'ok') throw new Error('expected ok');
    const intent = await intentByToken(link.token);
    const fetchMock = stubMercadoPago({ id: 9001, status: 'approved', external_reference: intent.id, transaction_amount: 800, currency_id: 'PEN' });

    expect((await POST(signedWebhook('9001'))).status).toBe(200);
    const paid = await intentByToken(link.token);
    expect(paid).toMatchObject({ status: 'paid', providerPaymentId: '9001', amountPaid: '800.00' });
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadopago.com/v1/payments/9001', expect.anything());

    expect((await POST(signedWebhook('9001'))).status).toBe(200);
    const after = await intentByToken(link.token);
    expect(after.paidAt).toEqual(paid.paidAt);
    expect(after.updatedAt).toEqual(paid.updatedAt);
  });

  it('Mercado Pago webhook leaves the intent pending on amount mismatch', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { POST } = await import('@/app/api/webhooks/mercadopago/route');
    const { orgId, chargeId } = await seedCharge(smoke.db);
    const link = await createOrReusePaymentLink(orgId, chargeId, mercadoPagoStub);
    if (link.kind !== 'ok') throw new Error('expected ok');
    const intent = await intentByToken(link.token);
    stubMercadoPago({ id: 9002, status: 'approved', external_reference: intent.id, transaction_amount: 1, currency_id: 'PEN' });

    expect((await POST(signedWebhook('9002'))).status).toBe(200);
    expect(await intentByToken(link.token)).toMatchObject({ status: 'pending', providerPaymentId: null, amountPaid: null, paidAt: null });
  });

  it('Mercado Pago webhook rejects a bad signature without calling the API', async () => {
    const { POST } = await import('@/app/api/webhooks/mercadopago/route');
    const fetchMock = stubMercadoPago({});
    expect((await POST(signedWebhook('9003', 'wrong-secret'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Mercado Pago webhook is disabled without credentials', async () => {
    const { POST } = await import('@/app/api/webhooks/mercadopago/route');
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', '');
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', '');
    expect((await POST(signedWebhook('9004'))).status).toBe(404);
  });

  it('isolates intents across orgs', async () => {
    const { createOrReusePaymentLink } = await import('@/lib/online-payments/links');
    const { sandboxAdapter } = await import('@/lib/online-payments/sandbox');
    const { listPaymentIntents, listLinkableCharges } = await import('@/lib/online-payments/queries');
    const a = await seedCharge(smoke.db);
    const b = await seedCharge(smoke.db);
    const linkA = await createOrReusePaymentLink(a.orgId, a.chargeId, sandboxAdapter);
    if (linkA.kind !== 'ok') throw new Error('expected ok');

    expect(await createOrReusePaymentLink(b.orgId, a.chargeId, sandboxAdapter)).toEqual({ kind: 'not_found' });
    const listB = await listPaymentIntents(b.orgId);
    expect(listB.items.map((i) => i.token)).not.toContain(linkA.token);
    expect((await listPaymentIntents(a.orgId)).items.map((i) => i.token)).toContain(linkA.token);
    expect((await listLinkableCharges(b.orgId)).map((c) => c.id)).toEqual([b.chargeId]);
  });

  it('never writes to the payments table', async () => {
    const rows = await smoke.db.select({ id: schema.payments.id }).from(schema.payments);
    expect(rows).toHaveLength(0);
  });
});
