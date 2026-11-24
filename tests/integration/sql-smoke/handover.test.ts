/**
 * Real-SQL smoke test for unit inventory and check-in/check-out acts: inventory
 * CRUD is org-scoped, an act snapshots its items, and signing an act through
 * POST /api/sign/[token] hashes the act PDF and marks the act signed without
 * touching the contract signature status. Auth, rate limiting, email and R2 are mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', denied: false }));
const storage = vi.hoisted(() => ({ files: new Map<string, Buffer>() }));
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.denied) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({
  getClientIp: vi.fn(() => '203.0.113.9'),
  signatureRateLimit: vi.fn(() => ({ success: true })),
  generatePdfRateLimit: vi.fn(() => ({ success: true })),
  mutationRateLimit: vi.fn(() => ({ success: true })),
  sendSignatureRateLimit: vi.fn(() => ({ success: true })),
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('@/lib/notifications/email', () => ({
  sendEmail,
  buildSignatureRequestEmail: vi.fn(() => ({ to: 'tenant@example.test', subject: 's', html: 'h' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async (_bucket: string, path: string, bytes: Buffer) => {
    storage.files.set(path, bytes);
  }),
  downloadFile: vi.fn(async (_bucket: string, path: string) => {
    const bytes = storage.files.get(path);
    if (!bytes) throw new Error('not found');
    return bytes;
  }),
  getSignedUrl: vi.fn(async (_bucket: string, path: string) => `https://r2.test/${path}`),
}));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
const PDF = Buffer.from('%PDF-1.7 smoke handover act');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ITEMS = [{ name: 'Refrigeradora', quantity: 1, condition: 'good', notes: null }];

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  auth.denied = false;
});

async function seedContract(name: string) {
  const org = await seedOrg(smoke.db, { name });
  const property = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db
    .insert(schema.units)
    .values({ id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label: '201' })
    .returning();
  const [tenant] = await smoke.db
    .insert(schema.tenants)
    .values({ id: crypto.randomUUID(), orgId: org.id, fullName: 'Inquilino Acta', email: 'tenant@example.test' })
    .returning();
  const [contract] = await smoke.db
    .insert(schema.contracts)
    .values({
      id: crypto.randomUUID(),
      orgId: org.id,
      tenantId: tenant.id,
      unitId: unit.id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      monthlyRent: 1200,
      signatureStatus: null,
    })
    .returning();
  auth.orgId = org.id;
  return { org, unit, contract };
}

function form(fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const actions = () => import('@/app/actions/handover');

async function createAct(contractId: string) {
  const { createHandoverAct } = await actions();
  return createHandoverAct({}, form({ contract_id: contractId, kind: 'check_in', items: JSON.stringify(ITEMS), notes: 'Llaves: 2' }));
}

function sign(token: string) {
  const request = new NextRequest(`http://localhost/api/sign/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'SmokeBrowser/2.0' },
    body: JSON.stringify({ signature_image_base64: `data:image/png;base64,${PNG.toString('base64')}`, typed_name: 'Inquilino Acta' }),
  });
  return import('@/app/api/sign/[token]/route').then(({ POST }) => POST(request, { params: Promise.resolve({ token }) }));
}

describe('unit inventory (real SQL)', () => {
  it('adds, updates and deletes items of an own unit', async () => {
    const { org, unit } = await seedContract('Inventory Org');
    const { saveInventoryItem, deleteInventoryItem } = await actions();

    expect((await saveInventoryItem({}, form({ unit_id: unit.id, name: 'Sofá', quantity: '2', condition: 'good' }))).error).toBeUndefined();
    const [item] = await smoke.db.select().from(schema.unitInventoryItems).where(eq(schema.unitInventoryItems.unitId, unit.id));
    expect(item).toMatchObject({ orgId: org.id, name: 'Sofá', quantity: 2, condition: 'good', notes: null });

    await saveInventoryItem({}, form({ id: item.id, unit_id: unit.id, name: 'Sofá', quantity: '2', condition: 'fair', notes: 'Mancha' }));
    const [updated] = await smoke.db.select().from(schema.unitInventoryItems).where(eq(schema.unitInventoryItems.id, item.id));
    expect(updated).toMatchObject({ condition: 'fair', notes: 'Mancha' });

    expect((await deleteInventoryItem({}, form({ id: item.id }))).error).toBeUndefined();
    expect(await smoke.db.select().from(schema.unitInventoryItems).where(eq(schema.unitInventoryItems.id, item.id))).toHaveLength(0);
  });

  it('returns NOT_FOUND for a unit or item of another org', async () => {
    const victim = await seedContract('Inventory Victim');
    const { saveInventoryItem, deleteInventoryItem } = await actions();
    await saveInventoryItem({}, form({ unit_id: victim.unit.id, name: 'TV', quantity: '1', condition: 'new' }));
    const [item] = await smoke.db.select().from(schema.unitInventoryItems).where(eq(schema.unitInventoryItems.unitId, victim.unit.id));
    await seedContract('Inventory Attacker');

    expect((await saveInventoryItem({}, form({ unit_id: victim.unit.id, name: 'X', quantity: '1', condition: 'new' }))).error?.code).toBe('NOT_FOUND');
    expect((await deleteInventoryItem({}, form({ id: item.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED without an admin session', async () => {
    auth.denied = true;
    const { saveInventoryItem } = await actions();

    expect((await saveInventoryItem({}, form({ unit_id: crypto.randomUUID(), name: 'X', quantity: '1', condition: 'new' }))).error?.code).toBe('UNAUTHORIZED');
  });
});

describe('handover acts (real SQL)', () => {
  it('creates a draft act with an items snapshot', async () => {
    const { contract } = await seedContract('Act Org');

    const result = await createAct(contract.id);

    expect(result.error).toBeUndefined();
    const [act] = await smoke.db.select().from(schema.handoverActs).where(eq(schema.handoverActs.id, result.data!.id));
    expect(act).toMatchObject({ contractId: contract.id, kind: 'check_in', status: 'draft', items: ITEMS, notes: 'Llaves: 2' });
  });

  it('rejects an act without items', async () => {
    const { contract } = await seedContract('Empty Act Org');
    const { createHandoverAct } = await actions();

    const result = await createHandoverAct({}, form({ contract_id: contract.id, kind: 'check_in', items: '[]' }));

    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('requires the PDF before sending for signature', async () => {
    const { contract } = await seedContract('No PDF Org');
    const { data } = await createAct(contract.id);
    const { sendHandoverActForSignature } = await actions();

    expect((await sendHandoverActForSignature({}, form({ handover_act_id: data!.id }))).error?.code).toBe('VALIDATION_ERROR');
  });

  it('signs an act: hashes the act PDF, marks the act signed and keeps the contract status', async () => {
    const { org, contract } = await seedContract('Sign Act Org');
    const { data } = await createAct(contract.id);
    const actId = data!.id;
    const { saveHandoverActPdf, sendHandoverActForSignature } = await actions();

    const file = new File([PDF], 'handover.pdf', { type: 'application/pdf' });
    expect((await saveHandoverActPdf({}, form({ handover_act_id: actId, file }))).error).toBeUndefined();
    expect((await sendHandoverActForSignature({}, form({ handover_act_id: actId }))).error).toBeUndefined();
    expect(sendEmail).toHaveBeenCalled();

    const [request] = await smoke.db.select().from(schema.signatureRequests).where(eq(schema.signatureRequests.handoverActId, actId));
    expect(request).toMatchObject({ orgId: org.id, contractId: contract.id });
    const [pending] = await smoke.db.select().from(schema.handoverActs).where(eq(schema.handoverActs.id, actId));
    expect(pending.status).toBe('pending_signature');

    const response = await sign(request.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'signed', documentSha256: sha256(PDF) });
    const [signed] = await smoke.db.select().from(schema.handoverActs).where(eq(schema.handoverActs.id, actId));
    expect(signed.status).toBe('signed');
    expect(signed.signedAt).toBeInstanceOf(Date);
    const [contractRow] = await smoke.db.select().from(schema.contracts).where(eq(schema.contracts.id, contract.id));
    expect(contractRow.signatureStatus).toBeNull();
    expect(storage.files.has(`${org.id}/${contract.id}/handover-${actId}-signature.png`)).toBe(true);
  });

  it('returns NOT_FOUND for a contract or act of another org', async () => {
    const victim = await seedContract('Act Victim');
    const { data } = await createAct(victim.contract.id);
    await seedContract('Act Attacker');
    const { getHandoverActSource, sendHandoverActForSignature } = await actions();

    expect((await createAct(victim.contract.id)).error?.code).toBe('NOT_FOUND');
    expect((await getHandoverActSource({}, form({ handover_act_id: data!.id }))).error?.code).toBe('NOT_FOUND');
    expect((await sendHandoverActForSignature({}, form({ handover_act_id: data!.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED without an admin session', async () => {
    auth.denied = true;
    const { getHandoverActSource } = await actions();

    expect((await getHandoverActSource({}, form({ handover_act_id: crypto.randomUUID() }))).error?.code).toBe('UNAUTHORIZED');
  });
});
