/**
 * Real-SQL smoke test for the document manager: uploads are org-scoped and
 * type-checked by content, the expiring filter works, and the tenant portal only
 * lists and signs URLs for documents shared with that tenant. Auth, rate limiting
 * and R2 are mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', userId: 'user-1', denied: false }));
const storage = vi.hoisted(() => ({ files: new Map<string, Buffer>(), deleted: [] as string[] }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.denied) throw new Error('unauthorized');
    return { userId: auth.userId, orgId: auth.orgId, role: 'admin', profile: {} };
  }),
  requireTenant: vi.fn(async () => {
    if (auth.denied) throw new Error('unauthorized');
    return { userId: auth.userId, orgId: auth.orgId, role: 'tenant', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async (_bucket: string, path: string, bytes: Buffer) => {
    storage.files.set(path, bytes);
  }),
  deleteImage: vi.fn(async (_bucket: string, path: string) => {
    storage.deleted.push(path);
  }),
  getSignedUrl: vi.fn(async (_bucket: string, path: string) => `https://r2.test/${path}`),
}));

const PDF = Buffer.from('%PDF-1.7 smoke document');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
const TODAY = '2026-06-01';

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
  auth.userId = 'user-1';
});

async function seedOrgWithTenant(name: string) {
  const org = await seedOrg(smoke.db, { name });
  const property = await seedProperty(smoke.db, org.id);
  const profile = await seedProfile(smoke.db, org.id, { role: 'tenant', fullName: 'Inquilina Docs', email: `${crypto.randomUUID()}@example.test` });
  const [unit] = await smoke.db
    .insert(schema.units)
    .values({ id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label: '301' })
    .returning();
  const [tenant] = await smoke.db
    .insert(schema.tenants)
    .values({ id: crypto.randomUUID(), orgId: org.id, fullName: 'Inquilina Docs', profileId: profile.id })
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
      monthlyRent: 1500,
      signatureStatus: null,
    })
    .returning();
  auth.orgId = org.id;
  return { org, property, profile, tenant, contract };
}

function form(fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const actions = () => import('@/app/actions/documents');
const queries = () => import('@/lib/documents/queries');

async function upload(entityType: string, entityId: string, extra: Record<string, string | Blob> = {}) {
  const { uploadDocument } = await actions();
  return uploadDocument({}, form({
    entity_type: entityType,
    entity_id: entityId,
    name: 'DNI',
    category: 'identity',
    file: new File([PDF], 'dni.pdf', { type: 'application/pdf' }),
    ...extra,
  }));
}

async function documentsOf(orgId: string) {
  return smoke.db.select().from(schema.documents).where(eq(schema.documents.orgId, orgId));
}

describe('document manager (real SQL)', () => {
  it('uploads a PDF and a PNG with content-detected MIME types under the org prefix', async () => {
    const { org, tenant, property } = await seedOrgWithTenant('Upload Org');

    expect((await upload('tenant', tenant.id, { expires_on: '2026-06-20', visible_to_tenant: 'on' })).error).toBeUndefined();
    expect((await upload('property', property.id, {
      name: 'Plano',
      category: 'other',
      visible_to_tenant: 'on',
      file: new File([PNG], 'plano.png', { type: 'image/png' }),
    })).error).toBeUndefined();

    const rows = await documentsOf(org.id);
    const pdf = rows.find((row) => row.tenantId === tenant.id)!;
    const png = rows.find((row) => row.propertyId === property.id)!;
    expect(pdf).toMatchObject({ mimeType: 'application/pdf', sizeBytes: PDF.length, expiresOn: '2026-06-20', visibleToTenant: true, uploadedBy: 'user-1' });
    expect(pdf.storagePath).toBe(`${org.id}/documents/${pdf.id}.pdf`);
    expect(storage.files.get(pdf.storagePath)).toEqual(PDF);
    expect(png).toMatchObject({ mimeType: 'image/png', visibleToTenant: false });
  });

  it('rejects a file whose content is not an allowed type', async () => {
    const { org, tenant } = await seedOrgWithTenant('Bad Type Org');

    const result = await upload('tenant', tenant.id, { file: new File([Buffer.from('MZ not a document')], 'x.pdf', { type: 'application/pdf' }) });

    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(await documentsOf(org.id)).toHaveLength(0);
  });

  it('returns NOT_FOUND when attaching to or touching another org', async () => {
    const victim = await seedOrgWithTenant('Docs Victim');
    await upload('tenant', victim.tenant.id);
    const [document] = await documentsOf(victim.org.id);
    await seedOrgWithTenant('Docs Attacker');
    const { deleteDocument, getDocumentUrl } = await actions();

    expect((await upload('contract', victim.contract.id)).error?.code).toBe('NOT_FOUND');
    expect((await deleteDocument({}, form({ id: document.id }))).error?.code).toBe('NOT_FOUND');
    expect((await getDocumentUrl({}, form({ id: document.id }))).error?.code).toBe('NOT_FOUND');
    expect(await documentsOf(victim.org.id)).toHaveLength(1);
  });

  it('signs an admin URL and deletes the row and the object', async () => {
    const { org, contract } = await seedOrgWithTenant('Delete Org');
    await upload('contract', contract.id);
    const [document] = await documentsOf(org.id);
    const { deleteDocument, getDocumentUrl } = await actions();

    expect((await getDocumentUrl({}, form({ id: document.id }))).data?.url).toBe(`https://r2.test/${document.storagePath}`);
    expect((await deleteDocument({}, form({ id: document.id }))).error).toBeUndefined();
    expect(await documentsOf(org.id)).toHaveLength(0);
    expect(storage.deleted).toContain(document.storagePath);
  });

  it('filters by entity and by expiring within 30 days', async () => {
    const { org, tenant, contract, property } = await seedOrgWithTenant('Filter Org');
    await upload('tenant', tenant.id, { name: 'Soon', expires_on: '2026-06-15' });
    await upload('contract', contract.id, { name: 'Later', expires_on: '2026-12-01' });
    await upload('property', property.id, { name: 'Expired', expires_on: '2026-05-01' });
    const { listOrgDocuments } = await queries();

    const contractDocs = await listOrgDocuments(org.id, { entity: 'contract' }, TODAY);
    expect(contractDocs.map((row) => [row.name, row.entityType, row.entityLabel])).toEqual([['Later', 'contract', 'Inquilina Docs']]);
    const expiring = await listOrgDocuments(org.id, { expiring: true }, TODAY);
    expect(expiring.map((row) => row.name)).toEqual(['Expired', 'Soon']);
  });

  it('shows the tenant only shared tenant and contract documents and signs URLs for them', async () => {
    const { org, profile, tenant, contract } = await seedOrgWithTenant('Portal Org');
    await upload('tenant', tenant.id, { name: 'Shared tenant', visible_to_tenant: 'on' });
    await upload('contract', contract.id, { name: 'Shared contract', visible_to_tenant: 'on' });
    await upload('contract', contract.id, { name: 'Private' });
    const other = await seedOrgWithTenant('Portal Other');
    await upload('tenant', other.tenant.id, { name: 'Other tenant', visible_to_tenant: 'on' });
    const [otherDocument] = await documentsOf(other.org.id);
    auth.orgId = org.id;
    auth.userId = profile.id;
    const { listTenantPortalDocuments } = await queries();
    const { getPortalDocumentUrl } = await actions();

    const visible = await listTenantPortalDocuments(org.id, tenant.id);
    expect(visible.map((row) => row.name).sort()).toEqual(['Shared contract', 'Shared tenant']);

    const rows = await documentsOf(org.id);
    const shared = rows.find((row) => row.name === 'Shared contract')!;
    const hidden = rows.find((row) => row.name === 'Private')!;
    expect((await getPortalDocumentUrl({}, form({ id: shared.id }))).data?.url).toBe(`https://r2.test/${shared.storagePath}`);
    expect((await getPortalDocumentUrl({}, form({ id: hidden.id }))).error?.code).toBe('NOT_FOUND');
    expect((await getPortalDocumentUrl({}, form({ id: otherDocument.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED without a session', async () => {
    auth.denied = true;
    const { getDocumentUrl, getPortalDocumentUrl } = await actions();

    expect((await upload('tenant', crypto.randomUUID())).error?.code).toBe('UNAUTHORIZED');
    expect((await getDocumentUrl({}, form({ id: crypto.randomUUID() }))).error?.code).toBe('UNAUTHORIZED');
    expect((await getPortalDocumentUrl({}, form({ id: crypto.randomUUID() }))).error?.code).toBe('UNAUTHORIZED');
  });
});
