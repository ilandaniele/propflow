import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeHandle } from './setup';
import * as schema from '@/lib/db/schema';
import { isSafeOrgScopedPath } from '@/lib/storage/path';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ userId: '', orgId: '', fail: false }));
const limiter = vi.hoisted(() => ({ allow: true }));
const storage = vi.hoisted(() => ({
  uploadFile: vi.fn(async (_bucket: string, path: string) => ({ path })),
  deleteImage: vi.fn(async () => undefined),
  getSignedUrl: vi.fn(async (bucket: string, path: string) => `https://signed.example/${bucket}/${path}`),
}));

vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireTenant: vi.fn(async () => {
    if (auth.fail) throw new Error('UNAUTHORIZED');
    return { userId: auth.userId, orgId: auth.orgId, role: 'tenant', profile: {} };
  }),
  requireAdmin: vi.fn(async () => { throw new Error('FORBIDDEN'); }),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  ...storage,
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: limiter.allow, retryAfterMs: 0 })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn(), paymentApproved: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  auth.fail = false;
  limiter.allow = true;
  storage.uploadFile.mockClear();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PDF = Buffer.from('%PDF-1.7\n%test\n', 'latin1');

async function seedTenantWithContract(orgId?: string) {
  const org = orgId ? { id: orgId } : await seedOrg(smoke.db);
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db.insert(schema.units)
    .values({ orgId: org.id, propertyId: property.id, label: `U-${crypto.randomUUID().slice(0, 6)}` })
    .returning();
  const profile = await seedProfile(smoke.db, org.id, { role: 'tenant', email: `${crypto.randomUUID()}@example.com` });
  const [tenant] = await smoke.db.insert(schema.tenants)
    .values({ orgId: org.id, fullName: 'Proof Tenant', unitId: unit.id, profileId: profile.id })
    .returning();
  const [contract] = await smoke.db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '900.00' })
    .returning();
  return { orgId: org.id, profileId: profile.id, tenantId: tenant.id, contractId: contract.id };
}

function signIn(who: { orgId: string; profileId: string }) {
  auth.orgId = who.orgId;
  auth.userId = who.profileId;
}

function paymentForm(contractId: string, proof?: File, overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { contract_id: contractId, amount: '900', paid_at: '2026-11-05', method: 'transfer', reference: 'OP-1', ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  if (proof) data.set('proof', proof);
  return data;
}

function paymentsOf(tenantId: string) {
  return smoke.db.select().from(schema.payments).where(eq(schema.payments.tenantId, tenantId));
}

describe('recordPayment with proof (real SQL)', () => {
  it('stores the proof under an org-scoped key in receipt_url plus the period', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    const proof = new File([PNG], 'voucher.png', { type: 'image/png' });
    const result = await recordPayment({}, paymentForm(me.contractId, proof, { period_month: '2026-11' }));
    expect(result.error).toBeUndefined();

    const [payment] = await paymentsOf(me.tenantId);
    expect(payment).toMatchObject({ orgId: me.orgId, contractId: me.contractId, status: 'pending', periodMonth: '2026-11', reference: 'OP-1' });
    expect(isSafeOrgScopedPath(payment.receiptUrl, me.orgId)).toBe(true);
    expect(payment.receiptUrl).toMatch(new RegExp(`^${me.orgId}/${me.contractId}/[0-9a-f-]{36}\\.png$`));
    expect(storage.uploadFile).toHaveBeenCalledWith('receipts', payment.receiptUrl, expect.any(Buffer), 'image/png');
  });

  it('records a payment without proof or period', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    expect((await recordPayment({}, paymentForm(me.contractId))).error).toBeUndefined();
    const [payment] = await paymentsOf(me.tenantId);
    expect(payment).toMatchObject({ receiptUrl: null, periodMonth: null });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('shows the proof to the tenant in the portal movements list', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const { GET } = await import('@/app/api/tenant/payments/movements/route');
    const me = await seedTenantWithContract();
    signIn(me);

    const proof = new File([PDF], 'voucher.pdf', { type: 'application/pdf' });
    expect((await recordPayment({}, paymentForm(me.contractId, proof, { period_month: '2026-10' }))).error).toBeUndefined();
    const [payment] = await paymentsOf(me.tenantId);

    const res = await GET(new NextRequest('http://localhost/api/tenant/payments/movements'));
    expect(res.status).toBe(200);
    const body = await res.json() as { movements: Array<{ id: string; receipt_url: string | null; period_month: string | null }> };
    const row = body.movements.find((m) => m.id === payment.id);
    expect(row).toMatchObject({ receipt_url: `https://signed.example/receipts/${payment.receiptUrl}`, period_month: '2026-10' });
  });

  it('rejects an oversized proof without uploading or inserting', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    const big = new File([PDF, new Uint8Array(5 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    const result = await recordPayment({}, paymentForm(me.contractId, big));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(result.error?.details).toMatchObject({ fieldErrors: { proof: ['too_large'] } });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(await paymentsOf(me.tenantId)).toHaveLength(0);
  });

  it('rejects a file whose magic bytes do not match its declared type', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    const spoofed = new File(['<script>alert(1)</script>'], 'voucher.png', { type: 'image/png' });
    const result = await recordPayment({}, paymentForm(me.contractId, spoofed));
    expect(result.error?.details).toMatchObject({ fieldErrors: { proof: ['invalid_type'] } });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(await paymentsOf(me.tenantId)).toHaveLength(0);
  });

  it('rejects another tenant\'s contract, in the same org or another org', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    const neighbour = await seedTenantWithContract(me.orgId);
    const stranger = await seedTenantWithContract();
    signIn(me);

    const proof = new File([PNG], 'voucher.png', { type: 'image/png' });
    expect((await recordPayment({}, paymentForm(neighbour.contractId, proof))).error?.code).toBe('NOT_FOUND');
    expect((await recordPayment({}, paymentForm(stranger.contractId, proof))).error?.code).toBe('NOT_FOUND');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(await paymentsOf(neighbour.tenantId)).toHaveLength(0);
    expect(await paymentsOf(stranger.tenantId)).toHaveLength(0);
  });

  it('returns UNAUTHORIZED without a tenant session and RATE_LIMITED when throttled', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    auth.fail = true;
    expect((await recordPayment({}, paymentForm(me.contractId))).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;

    limiter.allow = false;
    expect((await recordPayment({}, paymentForm(me.contractId))).error?.code).toBe('RATE_LIMITED');
    expect(await paymentsOf(me.tenantId)).toHaveLength(0);
  });

  it('rejects a malformed period', async () => {
    const { recordPayment } = await import('@/app/actions/payments');
    const me = await seedTenantWithContract();
    signIn(me);

    const result = await recordPayment({}, paymentForm(me.contractId, undefined, { period_month: '2026-13' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(await paymentsOf(me.tenantId)).toHaveLength(0);
  });
});
