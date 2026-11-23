import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.ctx.role !== 'admin') throw new Error('FORBIDDEN');
    return auth.ctx;
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  createPaymentFromBankLine,
  importBankStatement,
  matchBankLine,
  setBankLineIgnored,
} from '@/app/actions/bank-reconciliation';
import { listBankLines, openPaymentCandidates } from '@/lib/bank/reconciliation';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(values: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const STATEMENT = [
  'Fecha,Descripcion,Referencia,Monto',
  '05/03/2026,TRANSF JUAN PEREZ,OP-1,1200.00',
  '06/03/2026,DEPOSITO VARIOS,,350.00',
  '07/03/2026,COMISION,,-5.00',
].join('\n');

const upload = (text = STATEMENT) => importBankStatement(null, form({ file: new File([text], 'marzo.csv', { type: 'text/csv' }) }));

async function seedAdmin() {
  const org = await seedOrg(db);
  const admin = await seedProfile(db, org.id, { email: `admin-${org.id}@example.com` });
  const property = await seedProperty(db, org.id);
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'A1', status: 'occupied' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Juan Perez', unitId: unit.id }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '1200.00' })
    .returning();
  const [payment] = await db.insert(schema.payments)
    .values({ orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '1200.00', paidAt: '2026-03-04', status: 'pending' })
    .returning();
  auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
  return { org, admin, contract, payment };
}

describe('bank statement reconciliation (real SQL)', () => {
  it('imports credits once and skips duplicates on re-upload', async () => {
    const { org } = await seedAdmin();
    expect((await upload()).data).toEqual({ inserted: 2, duplicates: 0, skipped: 1 });
    expect((await upload()).data).toEqual({ inserted: 0, duplicates: 2, skipped: 1 });
    expect((await listBankLines(org.id, 'unmatched')).length).toBe(2);

    expect((await upload('a,b\n1,2')).error?.code).toBe('NO_HEADER');
    expect((await importBankStatement(null, form({}))).error?.code).toBe('VALIDATION_ERROR');
  });

  it('matches a line to an open payment, approves it and blocks a second match', async () => {
    const { org, payment } = await seedAdmin();
    await upload();
    expect((await openPaymentCandidates(org.id)).map((row) => row.tenantName)).toEqual(['Juan Perez']);

    const [first, second] = await listBankLines(org.id, 'unmatched');
    expect((await matchBankLine(null, form({ line_id: first.id, payment_id: payment.id }))).error).toBeUndefined();

    const [approved] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(approved.status).toBe('approved');
    expect((await listBankLines(org.id, 'matched')).map((row) => row.paymentId)).toEqual([payment.id]);

    expect((await matchBankLine(null, form({ line_id: second.id, payment_id: payment.id }))).error?.code).toBe('CONFLICT');
    expect((await matchBankLine(null, form({ line_id: first.id, payment_id: payment.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('creates an approved payment from a line and toggles ignored lines', async () => {
    const { org, contract } = await seedAdmin();
    await upload();
    const [first, second] = await listBankLines(org.id, 'unmatched');

    const created = await createPaymentFromBankLine(null, form({ line_id: first.id, contract_id: contract.id }));
    const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, created.data!.paymentId));
    expect(row).toMatchObject({ amount: first.amount, paidAt: first.postedOn, status: 'approved', importSource: 'manual' });

    expect((await setBankLineIgnored(null, form({ line_id: second.id, ignored: 'true' }))).error).toBeUndefined();
    expect((await listBankLines(org.id, 'unmatched')).length).toBe(0);
    expect((await setBankLineIgnored(null, form({ line_id: second.id, ignored: 'false' }))).error).toBeUndefined();
    expect((await listBankLines(org.id, 'unmatched')).length).toBe(1);
  });

  it('rejects cross-org access and non-admins', async () => {
    const { contract, payment } = await seedAdmin();
    await seedAdmin();
    await upload();
    const [line] = await listBankLines(auth.ctx.orgId, 'unmatched');

    expect((await matchBankLine(null, form({ line_id: line.id, payment_id: payment.id }))).error?.code).toBe('NOT_FOUND');
    expect((await createPaymentFromBankLine(null, form({ line_id: line.id, contract_id: contract.id }))).error?.code).toBe('NOT_FOUND');

    auth.ctx = { ...auth.ctx, role: 'tenant' };
    expect((await upload()).error?.code).toBe('UNAUTHORIZED');
  });
});
