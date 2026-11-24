import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { owners, properties, units } from '@/lib/db/schema';
import { normalize, ownerKeys, unitKey, type ExistingKeys, type PlannedRow } from './plan';
import type { DataImportKind } from './schemas';

async function propertyIdsByName(orgId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.orgId, orgId));
  return new Map(rows.map((row) => [normalize(row.name), row.id]));
}

async function existingKeys(orgId: string, kind: DataImportKind, byName: Map<string, string>): Promise<string[]> {
  if (kind === 'properties') return [...byName.keys()];
  if (kind === 'units') {
    const rows = await db.select({ propertyId: units.propertyId, label: units.label }).from(units).where(eq(units.orgId, orgId));
    return rows.map((row) => unitKey(row.propertyId, row.label));
  }
  const rows = await db.select({ name: owners.name, dni: owners.dni }).from(owners).where(eq(owners.orgId, orgId));
  return rows.flatMap((row) => ownerKeys(row.name, row.dni));
}

export async function loadExistingKeys(orgId: string, kind: DataImportKind): Promise<ExistingKeys> {
  const byName = await propertyIdsByName(orgId);
  return { propertyIdsByName: byName, keys: new Set(await existingKeys(orgId, kind, byName)) };
}

const TABLES = { properties, units, owners } as const;

export async function insertPlannedRows(orgId: string, kind: DataImportKind, rows: PlannedRow[]): Promise<number> {
  const table = TABLES[kind];
  const values = rows.filter((row) => row.status === 'new' && row.values).map((row) => ({ ...row.values, orgId }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- values are built per kind by planImport
  const batch = asBatch(chunk(values, rowsPerInsert(table)).map((part) => db.insert(table).values(part as any)));
  if (batch) await db.batch(batch);
  return values.length;
}
