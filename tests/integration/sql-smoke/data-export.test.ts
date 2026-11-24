/**
 * Real-SQL smoke test for the org data export: the ZIP only carries the caller
 * org's rows, pages past PAGE_SIZE, and reports counts in resumen.csv.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedContract, seedOrg, seedProperty, seedUnit, type SmokeDb } from './setup';
import { collectBytes, readStoredZip } from '../../fixtures/zip-reader';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

import { orgDataZip, PAGE_SIZE } from '@/lib/data-export/export';

const BULK_UNITS = PAGE_SIZE + 5;

let handle: Awaited<ReturnType<typeof createSmokeDb>>;
let db: SmokeDb;
let files: Map<string, string>;
const ids = { orgA: '', orgB: '', propertyA: '', propertyB: '', tenantA: '', tenantB: '' };

beforeAll(async () => {
  handle = await createSmokeDb();
  db = handle.db;
  dbBox.current = db;

  const orgA = await seedOrg(db, { name: 'Org A' });
  const orgB = await seedOrg(db, { name: 'Org B' });
  const propertyA = await seedProperty(db, orgA.id, { name: 'Edificio Alfa' });
  const propertyB = await seedProperty(db, orgB.id, { name: 'Edificio Beta' });
  const unitA = await seedUnit(db, orgA.id, propertyA.id, { label: 'A-101' });
  const unitB = await seedUnit(db, orgB.id, propertyB.id, { label: 'B-201' });
  const { tenant: tenantA } = await seedContract(db, orgA.id, unitA.id);
  const { tenant: tenantB } = await seedContract(db, orgB.id, unitB.id);
  Object.assign(ids, { orgA: orgA.id, orgB: orgB.id, propertyA: propertyA.id, propertyB: propertyB.id, tenantA: tenantA.id, tenantB: tenantB.id });

  await handle.d1
    .prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO units (id, org_id, property_id, label, created_at, updated_at)
       SELECT 'bulk-' || printf('%04d', i), ?2, ?3, 'Bulk ' || i, 0, 0 FROM n`,
    )
    .bind(BULK_UNITS, orgA.id, propertyA.id)
    .run();

  files = readStoredZip(await collectBytes(orgDataZip(orgA.id, new Date('2026-01-01T00:00:00Z'))));
}, 60_000);

afterAll(async () => {
  await handle?.close();
});

describe('orgDataZip (real D1)', () => {
  it('contains one CSV per entity plus the summary', () => {
    expect(files.has('propiedades.csv')).toBe(true);
    expect(files.has('inquilinos.csv')).toBe(true);
    expect(files.has('resumen.csv')).toBe(true);
  });

  it('exports only the caller org rows', () => {
    const everything = [...files.values()].join('\n');
    expect(files.get('propiedades.csv')).toContain('Edificio Alfa');
    expect(files.get('inquilinos.csv')).toContain(ids.tenantA);
    for (const foreign of ['Edificio Beta', 'B-201', ids.orgB, ids.propertyB, ids.tenantB]) {
      expect(everything).not.toContain(foreign);
    }
  });

  it('pages through every unit and reports counts in resumen.csv', () => {
    const unitLines = files.get('unidades.csv')!.trim().split('\r\n');
    expect(unitLines).toHaveLength(1 + BULK_UNITS + 1);
    expect(new Set(unitLines).size).toBe(unitLines.length);
    expect(files.get('resumen.csv')).toContain(`unidades.csv,${BULK_UNITS + 1},no`);
    expect(files.get('resumen.csv')).toContain('propiedades.csv,1,no');
  });
});
