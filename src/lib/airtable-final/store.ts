/**
 * DB access for the one-off Airtable attachment copy.
 * Identifiers interpolated with sql.raw() come from the static ATTACHMENT_COLUMNS
 * list, never from request input.
 */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import type { AttachmentColumn } from './fields';

export interface ColumnRow {
  id: string;
  orgId: string;
  recordId: string;
  value: string;
}

export interface SnapshotRow {
  orgId: string;
  table: string;
  recordId: string;
  data: unknown;
}

const AIRTABLE_URL_FILTER = (column: SQL): SQL =>
  sql`(${column} LIKE 'https://%airtableusercontent.com/%' OR ${column} LIKE 'https://dl.airtable.com/%')`;

function columnRefs(col: AttachmentColumn) {
  return {
    table: sql.raw(col.dbTable),
    value: sql.raw(col.dbColumn),
    recordId: sql.raw(col.idColumn),
  };
}

function inList(values: readonly string[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

const notIn = (excludeIds: readonly string[]): SQL =>
  excludeIds.length > 0 ? sql` AND id::text NOT IN (${inList(excludeIds)})` : sql``;

export async function listPendingColumnRows(
  col: AttachmentColumn,
  limit: number,
  excludeIds: readonly string[] = [],
): Promise<ColumnRow[]> {
  const { table, value, recordId } = columnRefs(col);
  const rows = await db.execute(sql`
    SELECT id, org_id AS "orgId", ${recordId} AS "recordId", ${value} AS value
    FROM ${table}
    WHERE ${recordId} IS NOT NULL AND ${AIRTABLE_URL_FILTER(value)}${notIn(excludeIds)}
    ORDER BY id
    LIMIT ${limit}
  `);
  return rows as unknown as ColumnRow[];
}

export async function countPendingColumnRows(col: AttachmentColumn, excludeIds: readonly string[] = []): Promise<number> {
  const { table, value, recordId } = columnRefs(col);
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${table}
    WHERE ${recordId} IS NOT NULL AND ${AIRTABLE_URL_FILTER(value)}${notIn(excludeIds)}
  `);
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

/** Column rows by id, whatever their current value. */
export async function findColumnRows(col: AttachmentColumn, rowIds: readonly string[]): Promise<ColumnRow[]> {
  if (rowIds.length === 0) return [];
  const { table, value, recordId } = columnRefs(col);
  const rows = await db.execute(sql`
    SELECT id, org_id AS "orgId", ${recordId} AS "recordId", ${value} AS value
    FROM ${table}
    WHERE id::text IN (${inList(rowIds)})
  `);
  return rows as unknown as ColumnRow[];
}

/** Replaces the Airtable URL with the storage path; false when the row changed meanwhile. */
export async function setColumnValue(
  col: AttachmentColumn,
  rowId: string,
  previousValue: string,
  storagePath: string,
): Promise<boolean> {
  const { table, value } = columnRefs(col);
  const rows = await db.execute(sql`
    UPDATE ${table} SET ${value} = ${storagePath}
    WHERE id = ${rowId} AND ${value} = ${previousValue}
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length === 1;
}

/** Snapshot rows that contain at least one Airtable attachment URL. */
export async function listSnapshotRows(): Promise<SnapshotRow[]> {
  const rows = await db.execute(sql`
    SELECT org_id AS "orgId", table_name AS "table", external_id AS "recordId", data
    FROM airtable_snapshots
    WHERE data::text LIKE '%airtableusercontent.com%' OR data::text LIKE '%dl.airtable.com%'
    ORDER BY table_name, external_id
  `);
  return rows as unknown as SnapshotRow[];
}

/** Every snapshot row of one Airtable table, whatever it contains. */
export async function listSnapshotTable(table: string): Promise<Array<{ recordId: string; data: unknown }>> {
  const rows = await db.execute(sql`
    SELECT external_id AS "recordId", data
    FROM airtable_snapshots
    WHERE table_name = ${table}
  `);
  return rows as unknown as Array<{ recordId: string; data: unknown }>;
}

/** airtable_external_id -> units.id */
export async function findUnitIds(orgId: string, airtableIds: readonly string[]): Promise<Map<string, string>> {
  if (airtableIds.length === 0) return new Map();
  const rows = await db.execute(sql`
    SELECT id, airtable_external_id AS "airtableId" FROM units
    WHERE org_id = ${orgId} AND airtable_external_id IN (${inList(airtableIds)})
  `);
  return new Map((rows as unknown as Array<{ id: string; airtableId: string }>).map((r) => [r.airtableId, r.id]));
}

export interface UnitImageInput {
  orgId: string;
  unitId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Same row shape as `uploadUnitImage` (src/app/actions/unit-images.ts), appended after existing images. */
export async function insertUnitImage(input: UnitImageInput): Promise<void> {
  await db.execute(sql`
    INSERT INTO unit_images (org_id, unit_id, storage_path, filename, mime_type, size_bytes, sort_order, is_cover)
    VALUES (
      ${input.orgId}, ${input.unitId}, ${input.storagePath}, ${input.filename.slice(0, 255)},
      ${input.mimeType}, ${input.sizeBytes},
      (SELECT count(*)::int FROM unit_images WHERE unit_id = ${input.unitId}),
      false
    )
  `);
}
