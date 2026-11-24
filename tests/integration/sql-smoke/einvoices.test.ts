import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  vi.stubEnv('NUBEFACT_API_URL', '');
  vi.stubEnv('NUBEFACT_API_TOKEN', '');
  auth.fail = false;
});

async function seedOrgWithCharges(amounts: string[]) {
  const org = await seedOrg(smoke.db);
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db.insert(schema.units)
    .values({ orgId: org.id, propertyId: property.id, label: '101' })
    .returning();
  const [tenant] = await smoke.db.insert(schema.tenants)
    .values({ orgId: org.id, fullName: 'Ana Pérez', unitId: unit.id })
    .returning();
  const [contract] = await smoke.db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '1180' })
    .returning();
  const charges = await smoke.db.insert(schema.charges)
    .values(amounts.map((amount, i) => ({
      orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount, period: `2026-${String(i + 1).padStart(2, '0')}`,
    })))
    .returning();
  return { org, charges };
}

function emitForm(chargeId: string, overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { charge_id: chargeId, doc_type: 'boleta', customer_doc_type: 'dni', customer_doc_number: '12345678', customer_name: 'Ana Pérez', ...overrides };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function docsOf(orgId: string) {
  return smoke.db.select().from(schema.einvoices).where(eq(schema.einvoices.orgId, orgId)).orderBy(schema.einvoices.number);
}

describe('emitEinvoiceAction (real SQL)', () => {
  it('assigns consecutive numbers per series and stores IGV amounts', async () => {
    const { emitEinvoiceAction } = await import('@/app/actions/einvoices');
    const { org, charges } = await seedOrgWithCharges(['1180', '500', '2360']);
    auth.orgId = org.id;

    for (const charge of charges.slice(0, 2)) {
      expect((await emitEinvoiceAction(null, emitForm(charge.id))).error).toBeUndefined();
    }
    const factura = await emitEinvoiceAction(null, emitForm(charges[2].id, {
      doc_type: 'factura', customer_doc_type: 'ruc', customer_doc_number: '20131312955', customer_name: 'Empresa SAC',
    }));
    expect(factura.error).toBeUndefined();

    const docs = await docsOf(org.id);
    expect(docs.map((d) => [d.series, d.number])).toEqual([['B001', 1], ['F001', 1], ['B001', 2]]);
    expect(docs[0]).toMatchObject({
      chargeId: charges[0].id, docType: 'boleta', total: '1180.00', base: '1000.00', igv: '180.00',
      currency: 'PEN', provider: 'sandbox', status: 'accepted_sandbox', customerDocType: 'dni', customerDocNumber: '12345678',
    });

    const series = await smoke.db.select().from(schema.einvoiceSeries).where(eq(schema.einvoiceSeries.orgId, org.id));
    expect(Object.fromEntries(series.map((s) => [s.series, s.nextNumber]))).toEqual({ B001: 3, F001: 2 });
  });

  it('allows one document per charge and does not burn a number on a retry', async () => {
    const { emitEinvoiceAction } = await import('@/app/actions/einvoices');
    const { org, charges } = await seedOrgWithCharges(['100', '200']);
    auth.orgId = org.id;

    expect((await emitEinvoiceAction(null, emitForm(charges[0].id))).error).toBeUndefined();
    expect((await emitEinvoiceAction(null, emitForm(charges[0].id))).error?.code).toBe('CONFLICT');
    expect((await emitEinvoiceAction(null, emitForm(charges[1].id))).error).toBeUndefined();

    expect((await docsOf(org.id)).map((d) => d.number)).toEqual([1, 2]);
  });

  it('rolls back the correlative when the batch hits the one-per-charge constraint', async () => {
    const { reserveEinvoice } = await import('@/lib/einvoice/queries');
    const { org, charges } = await seedOrgWithCharges(['100']);
    const draft = {
      orgId: org.id, chargeId: charges[0].id, docType: 'boleta' as const, series: 'B001',
      customerDocType: 'none' as const, customerDocNumber: null, customerName: 'Ana', provider: 'sandbox' as const,
      total: '100.00', base: '84.75', igv: '15.25',
    };

    expect(await reserveEinvoice(draft)).toMatchObject({ number: 1 });
    await expect(reserveEinvoice(draft)).rejects.toThrow();

    const [series] = await smoke.db.select().from(schema.einvoiceSeries)
      .where(and(eq(schema.einvoiceSeries.orgId, org.id), eq(schema.einvoiceSeries.series, 'B001')));
    expect(series.nextNumber).toBe(2);
  });

  it('keeps correlatives independent across orgs and hides charges of other orgs', async () => {
    const { emitEinvoiceAction } = await import('@/app/actions/einvoices');
    const { listEinvoices, listEmittableCharges } = await import('@/lib/einvoice/queries');
    const mine = await seedOrgWithCharges(['100']);
    const other = await seedOrgWithCharges(['100']);

    auth.orgId = other.org.id;
    expect((await emitEinvoiceAction(null, emitForm(other.charges[0].id))).error).toBeUndefined();

    auth.orgId = mine.org.id;
    expect((await emitEinvoiceAction(null, emitForm(other.charges[0].id))).error?.code).toBe('NOT_FOUND');
    expect((await emitEinvoiceAction(null, emitForm(mine.charges[0].id))).error).toBeUndefined();

    expect((await docsOf(mine.org.id)).map((d) => d.number)).toEqual([1]);
    expect((await listEinvoices(mine.org.id, 1)).items.map((d) => d.series + '-' + d.number)).toEqual(['B001-1']);
    expect(await listEmittableCharges(mine.org.id)).toEqual([]);
  });

  it('lists only charges without a document', async () => {
    const { emitEinvoiceAction } = await import('@/app/actions/einvoices');
    const { listEmittableCharges } = await import('@/lib/einvoice/queries');
    const { org, charges } = await seedOrgWithCharges(['100', '200']);
    auth.orgId = org.id;

    await emitEinvoiceAction(null, emitForm(charges[0].id));
    expect((await listEmittableCharges(org.id)).map((c) => c.id)).toEqual([charges[1].id]);
  });

  it('rejects invalid customer documents, bad input and non-admins', async () => {
    const { emitEinvoiceAction } = await import('@/app/actions/einvoices');
    const { org, charges } = await seedOrgWithCharges(['700']);
    auth.orgId = org.id;

    const anonymous = await emitEinvoiceAction(null, emitForm(charges[0].id, { customer_doc_type: 'none', customer_doc_number: '' }));
    expect(anonymous.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'document_required' } });
    const badRuc = await emitEinvoiceAction(null, emitForm(charges[0].id, { doc_type: 'factura', customer_doc_type: 'ruc', customer_doc_number: '20131312954' }));
    expect(badRuc.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'invalid_ruc' } });
    expect((await emitEinvoiceAction(null, emitForm('not-a-uuid'))).error?.code).toBe('VALIDATION_ERROR');

    auth.fail = true;
    expect((await emitEinvoiceAction(null, emitForm(charges[0].id))).error?.code).toBe('UNAUTHORIZED');

    expect(await docsOf(org.id)).toHaveLength(0);
  });
});
