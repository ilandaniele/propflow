/**
 * Real-SQL smoke test for the CSV import from other software: preview classifies
 * rows as new, duplicate, invalid or unknown property, and commit inserts only the
 * new rows into the caller's org. Auth and rate limiting are mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', denied: false }));
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
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

function csvForm(kind: string, csv: string) {
  const data = new FormData();
  data.set('kind', kind);
  data.set('file', new File([csv], 'import.csv', { type: 'text/csv' }));
  return data;
}

const actions = () => import('@/app/actions/data-import');

async function newOrg(name: string) {
  const org = await seedOrg(smoke.db, { name });
  auth.orgId = org.id;
  return org;
}

describe('data import from other software (real SQL)', () => {
  it('previews properties without writing and commits only new rows', async () => {
    const org = await newOrg('Import Props');
    await smoke.db.insert(schema.properties).values({ id: crypto.randomUUID(), orgId: org.id, name: 'Casa Norte' });
    const csv = 'Name,Address,City\nCasa Norte,Av 1,Lima\nCasa Sur,Av 2,Lima\ncasa sur,Av 3,Lima\n,Av 4,Lima\n';
    const { previewDataImport, commitDataImport } = await actions();

    const preview = await previewDataImport({}, csvForm('properties', csv));
    expect(preview.data?.counts).toEqual({ new: 1, duplicate: 2, invalid: 1, unknown_property: 0 });
    expect(preview.data?.rows.find((row) => row.status === 'invalid')?.fields).toEqual(['name']);
    expect(await smoke.db.select().from(schema.properties).where(eq(schema.properties.orgId, org.id))).toHaveLength(1);

    expect((await commitDataImport({}, csvForm('properties', csv))).data).toEqual({ inserted: 1, skipped: 3 });
    const rows = await smoke.db.select().from(schema.properties).where(eq(schema.properties.orgId, org.id));
    expect(rows.find((row) => row.name === 'Casa Sur')).toMatchObject({ address: 'Av 2', city: 'Lima' });
  });

  it('links units to existing properties by name and flags unknown properties', async () => {
    const org = await newOrg('Import Units');
    const property = await seedProperty(smoke.db, org.id);
    await smoke.db.insert(schema.units).values({ id: crypto.randomUUID(), orgId: org.id, propertyId: property.id, label: '101' });
    const csv = [
      'property_name,label,floor,bedrooms,monthly_rent,toilet_type',
      `${property.name},101,1,1,900,private`,
      `${property.name},102,1,2,1200.50,shared`,
      'Otra Casa,201,2,1,800,',
      `${property.name},103,1,-1,800,`,
    ].join('\n');
    const { commitDataImport } = await actions();

    expect((await commitDataImport({}, csvForm('units', csv))).data).toEqual({ inserted: 1, skipped: 3 });
    const rows = await smoke.db.select().from(schema.units).where(eq(schema.units.orgId, org.id));
    expect(rows.find((row) => row.label === '102')).toMatchObject({ propertyId: property.id, bedrooms: 2, monthlyRentDefault: '1200.50', toiletType: 'shared', status: 'vacant' });
  });

  it('dedupes owners by DNI or name and validates email', async () => {
    const org = await newOrg('Import Owners');
    await smoke.db.insert(schema.owners).values({ id: crypto.randomUUID(), orgId: org.id, name: 'Ana Pérez', dni: '11111111' });
    const csv = 'name,dni,email\nOtra Ana,11111111,\nana pérez,,\nLuis Gómez,22222222,luis@example.test\nMal Mail,,no-es-mail\n';
    const { previewDataImport, commitDataImport } = await actions();

    expect((await previewDataImport({}, csvForm('owners', csv))).data?.counts).toEqual({ new: 1, duplicate: 2, invalid: 1, unknown_property: 0 });
    expect((await commitDataImport({}, csvForm('owners', csv))).data?.inserted).toBe(1);
    const rows = await smoke.db.select().from(schema.owners).where(eq(schema.owners.orgId, org.id));
    expect(rows.map((row) => row.name).sort()).toEqual(['Ana Pérez', 'Luis Gómez']);
  });

  it('inserts large files in chunks under the D1 parameter limit', async () => {
    const org = await newOrg('Import Bulk');
    const csv = ['name,dni,phone,email,domicilio,distrito', ...Array.from({ length: 60 }, (_, i) => `Owner ${i},${10000000 + i},999,o${i}@example.test,Calle ${i},Miraflores`)].join('\n');
    const { commitDataImport } = await actions();

    expect((await commitDataImport({}, csvForm('owners', csv))).data?.inserted).toBe(60);
    expect(await smoke.db.select().from(schema.owners).where(eq(schema.owners.orgId, org.id))).toHaveLength(60);
  });

  it('only sees the caller org when checking duplicates', async () => {
    const other = await newOrg('Import Other');
    await smoke.db.insert(schema.properties).values({ id: crypto.randomUUID(), orgId: other.id, name: 'Compartida' });
    const org = await newOrg('Import Mine');
    const { commitDataImport } = await actions();

    expect((await commitDataImport({}, csvForm('properties', 'name\nCompartida\n'))).data?.inserted).toBe(1);
    expect(await smoke.db.select().from(schema.properties).where(eq(schema.properties.orgId, org.id))).toHaveLength(1);
  });

  it('rejects a bad kind and returns UNAUTHORIZED without a session', async () => {
    await newOrg('Import Errors');
    const { previewDataImport, commitDataImport } = await actions();

    expect((await previewDataImport({}, csvForm('tenants', 'name\nX\n'))).error?.code).toBe('VALIDATION_ERROR');
    auth.denied = true;
    expect((await previewDataImport({}, csvForm('properties', 'name\nX\n'))).error?.code).toBe('UNAUTHORIZED');
    expect((await commitDataImport({}, csvForm('properties', 'name\nX\n'))).error?.code).toBe('UNAUTHORIZED');
  });
});
