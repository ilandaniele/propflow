import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (!authBox.ctx) throw new Error('unauthorized');
    return authBox.ctx;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { countExpiringDocuments, listExpiringDocuments } = await import('@/lib/document-expirations/queries');
const actions = await import('@/app/actions/document-expirations');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  authBox.ctx = null;
});

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function seedTenant(db: SmokeDb, orgId: string, fullName: string) {
  const [row] = await db.insert(schema.tenants).values({ orgId, fullName }).returning();
  return row;
}

describe('expiring documents queries', () => {
  it('lists with subject names and counts expired / soon per org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const tenant = await seedTenant(db, org.id, 'Ana');
    const property = await seedProperty(db, org.id, { name: 'Torre A' });
    await db.insert(schema.expiringDocuments).values([
      { orgId: org.id, kind: 'dni', label: 'DNI Ana', expiresOn: '2026-11-01', tenantId: tenant.id },
      { orgId: org.id, kind: 'insurance', label: 'Póliza', expiresOn: '2026-12-10', propertyId: property.id },
      { orgId: org.id, kind: 'certificate', label: 'Defensa civil', expiresOn: '2027-06-01' },
      { orgId: other.id, kind: 'dni', label: 'Ajeno', expiresOn: '2026-11-01' },
    ]);

    const rows = await listExpiringDocuments(org.id);
    expect(rows.map((r) => [r.label, r.tenantName, r.propertyName])).toEqual([
      ['DNI Ana', 'Ana', null],
      ['Póliza', null, 'Torre A'],
      ['Defensa civil', null, null],
    ]);
    expect(await countExpiringDocuments(org.id, '2026-11-23')).toEqual({ expired: 1, soon: 1 });
    expect(await countExpiringDocuments(other.id, '2026-11-23')).toEqual({ expired: 1, soon: 0 });
    const empty = await seedOrg(db, { name: 'Empty' });
    expect(await countExpiringDocuments(empty.id, '2026-11-23')).toEqual({ expired: 0, soon: 0 });
  });
});

describe('createExpiringDocument', () => {
  const valid = { kind: 'insurance', label: 'Póliza', expires_on: '2027-01-15', tenant_id: '', property_id: '' };

  it('rejects anonymous callers', async () => {
    const result = await actions.createExpiringDocument({}, form(valid));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid input', async () => {
    const org = await seedOrg(smoke.db);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
    const result = await actions.createExpiringDocument({}, form({ ...valid, expires_on: '15/01/2027' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects tenants or properties from another org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const foreignTenant = await seedTenant(db, other.id, 'Ajeno');
    const foreignProperty = await seedProperty(db, other.id);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.createExpiringDocument({}, form({ ...valid, tenant_id: foreignTenant.id }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.createExpiringDocument({}, form({ ...valid, property_id: foreignProperty.id }))).error?.code).toBe('NOT_FOUND');
    expect(await listExpiringDocuments(org.id)).toHaveLength(0);
  });

  it('creates a document linked to own tenant', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const tenant = await seedTenant(db, org.id, 'Luis');
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    const result = await actions.createExpiringDocument({}, form({ ...valid, kind: 'dni', label: ' DNI Luis ', tenant_id: tenant.id }));
    expect(result.error).toBeUndefined();
    const rows = await listExpiringDocuments(org.id);
    expect(rows.map((r) => [r.kind, r.label, r.expiresOn, r.tenantName])).toEqual([['dni', 'DNI Luis', '2027-01-15', 'Luis']]);
  });
});

describe('removeExpiringDocument', () => {
  it('deletes own documents only', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const [mine, theirs] = await db.insert(schema.expiringDocuments).values([
      { orgId: org.id, kind: 'other', label: 'Mío', expiresOn: '2027-01-01' },
      { orgId: other.id, kind: 'other', label: 'Ajeno', expiresOn: '2027-01-01' },
    ]).returning();
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.removeExpiringDocument({}, form({ id: theirs.id }))).error?.code).toBe('NOT_FOUND');
    expect(await db.select().from(schema.expiringDocuments).where(eq(schema.expiringDocuments.id, theirs.id))).toHaveLength(1);

    expect((await actions.removeExpiringDocument({}, form({ id: mine.id }))).error).toBeUndefined();
    expect(await db.select().from(schema.expiringDocuments).where(eq(schema.expiringDocuments.id, mine.id))).toHaveLength(0);
  });
});
