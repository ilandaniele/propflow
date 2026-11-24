import { and, asc, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { CSV_BOM, toCsvLine } from '@/lib/csv/write';
import { EXPORT_TABLES, type ExportTable } from './tables';
import { zipStore, type ZipEntry } from './zip';

export const PAGE_SIZE = 500;
export const MAX_ROWS_PER_TABLE = 50_000;

type TableCount = { file: string; rows: number; truncated: boolean };

export function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function rowToCsvLine(row: Record<string, unknown>, headers: string[]): string {
  return toCsvLine(headers.map((header) => formatCell(row[header])));
}

async function fetchPage(orgId: string, spec: ExportTable, afterId: string | null, limit: number) {
  const rows = await db
    .select(spec.columns)
    .from(spec.table)
    .where(and(eq(spec.table.orgId, orgId), afterId ? gt(spec.table.id, afterId) : undefined))
    .orderBy(asc(spec.table.id))
    .limit(limit);
  return rows as Record<string, unknown>[];
}

/** Keyset-paginated CSV for one org-scoped table; memory stays at one page. */
async function* tableCsv(orgId: string, spec: ExportTable, count: TableCount): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const headers = Object.keys(spec.columns);
  yield encoder.encode(CSV_BOM + toCsvLine(headers));

  let afterId: string | null = null;
  while (count.rows < MAX_ROWS_PER_TABLE) {
    const limit = Math.min(PAGE_SIZE, MAX_ROWS_PER_TABLE - count.rows);
    const rows = await fetchPage(orgId, spec, afterId, limit + 1);
    const page = rows.slice(0, limit);
    if (page.length === 0) return;
    yield encoder.encode(page.map((row) => rowToCsvLine(row, headers)).join(''));
    count.rows += page.length;
    afterId = String(page[page.length - 1].id);
    if (rows.length <= limit) return;
  }
  count.truncated = true;
}

async function* summaryCsv(counts: TableCount[]): AsyncGenerator<Uint8Array> {
  const lines = counts.map((c) => toCsvLine([c.file, c.rows, c.truncated ? 'si' : 'no']));
  yield new TextEncoder().encode(CSV_BOM + toCsvLine(['archivo', 'filas', 'truncado']) + lines.join(''));
}

/** Streams a ZIP with one CSV per entity of `orgId`, plus resumen.csv with row counts. */
export function orgDataZip(orgId: string, now = new Date()): AsyncGenerator<Uint8Array> {
  const counts: TableCount[] = [];
  const entries: ZipEntry[] = EXPORT_TABLES.map((spec) => {
    const count: TableCount = { file: spec.file, rows: 0, truncated: false };
    counts.push(count);
    return { name: spec.file, chunks: tableCsv(orgId, spec, count) };
  });
  entries.push({ name: 'resumen.csv', chunks: summaryCsv(counts) });
  return zipStore(entries, now);
}
