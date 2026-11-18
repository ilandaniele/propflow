#!/usr/bin/env node
// W-CF-51 — Turns the Postgres export into SQL files for D1.
//
// Usage:
//   node scripts/migrate-to-d1/transform.mjs --in .migration/export --out .migration/sql [--batch 50]
//
// Input (written by export.mjs), per table:
//   <table>.jsonl         one row per line
//   <table>.columns.json  { column: pg data_type }
// Output: NNNN_<table>.sql in foreign-key order, plus manifest.json
//   [{ table, rows, excludedChildren, droppedColumns, files[] }].
// Rows whose foreign key points at a row that is not migrated (children of the
// excluded cross-org copies) are left out and counted in excludedChildren.
// Prints counts only.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTables } from './tables.mjs';

/** D1 rejects SQL statements longer than 100,000 bytes; keep a margin. */
export const MAX_STATEMENT_BYTES = 90_000;
const ROWS_PER_FILE = 5_000;
const FILE_HEADER = 'PRAGMA defer_foreign_keys = ON;\n';

const TIMESTAMP_TYPES = new Set(['timestamp with time zone', 'timestamp without time zone']);
const JSON_TYPES = new Set(['json', 'jsonb', 'ARRAY']);
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint']);
const INTEGER_TEXT = /^-?\d+$/;

export function quote(text) {
  if (text.includes('\0')) throw new Error('NUL character in text value');
  return `'${text.replaceAll("'", "''")}'`;
}

/** Postgres timestamp text (any offset; none means UTC) or ISO string to epoch ms. */
export function toEpochMs(value) {
  const iso = String(value)
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(/Z$|[+-]\d{2}:\d{2}$/i.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(ms)) throw new Error('invalid timestamp value');
  return ms;
}

/** One value as a SQLite literal, by its Postgres type (or, without one, by the value and the D1 column type). */
export function toLiteral(value, pgType, d1Type) {
  if (value === null || value === undefined) return 'NULL';
  if (TIMESTAMP_TYPES.has(pgType)) return String(toEpochMs(value));
  if (pgType === 'date') return quote(String(value).slice(0, 10));
  if (pgType === 'boolean' || typeof value === 'boolean') return value === true ? '1' : '0';
  if (JSON_TYPES.has(pgType) || typeof value === 'object') return quote(JSON.stringify(value));
  if (INTEGER_TYPES.has(pgType)) {
    if (!INTEGER_TEXT.test(String(value))) throw new Error('invalid integer value');
    return String(value);
  }
  if (d1Type === 'integer') return INTEGER_TEXT.test(String(value)) ? String(value) : String(toEpochMs(value));
  return quote(String(value));
}

/** Drops rows whose foreign keys point at rows that are not kept, and records the kept ids. */
export function filterChildren(table, rows, keptIds) {
  const idColumn = table.primaryKey.length === 1 ? table.primaryKey[0] : null;
  const references = table.foreignKeys.filter((fk) => fk.table === table.name || keptIds.has(fk.table));
  const idsOf = (list) => new Set(idColumn ? list.map((r) => r[idColumn]) : []);
  let kept = rows;
  for (;;) {
    const own = idsOf(kept);
    const parentIds = (name) => (name === table.name ? own : keptIds.get(name));
    const next = kept.filter((row) => references.every((fk) => row[fk.column] == null || parentIds(fk.table).has(row[fk.column])));
    if (next.length === kept.length) break;
    kept = next;
  }
  keptIds.set(table.name, idsOf(kept));
  return { rows: kept, excluded: rows.length - kept.length };
}

function insertPrefix(table, columns) {
  return `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES\n`;
}

/** A row too long for one statement: insert it with its long texts empty, then append them in pieces. */
function splitLongRow(table, columns, values, primaryKey) {
  const where = primaryKey.map((c) => `\`${c}\` = ${values[columns.indexOf(c)]}`).join(' AND ');
  const pieceChars = Math.floor(MAX_STATEMENT_BYTES / 8);
  const updates = [];
  const first = values.map((literal, i) => {
    if (literal.length <= pieceChars || primaryKey.includes(columns[i])) return literal;
    const text = literal.slice(1, -1).replaceAll("''", "'");
    for (let at = 0; at < text.length; at += pieceChars) {
      updates.push(`UPDATE \`${table}\` SET \`${columns[i]}\` = \`${columns[i]}\` || ${quote(text.slice(at, at + pieceChars))} WHERE ${where};`);
    }
    return "''";
  });
  return [`${insertPrefix(table, columns)}(${first.join(', ')});`, ...updates];
}

/** INSERT statements for one table: up to `batch` rows each, never over MAX_STATEMENT_BYTES. */
export function buildStatements(table, rows, pgTypes, batch) {
  const d1Types = new Map(table.columns.map((c) => [c.name, c.type]));
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const columns = table.columns.map((c) => c.name).filter((c) => present.has(c));
  const prefix = insertPrefix(table.name, columns);
  const statements = [];
  let tuples = [];
  let bytes = Buffer.byteLength(prefix);
  const flush = () => {
    if (tuples.length) statements.push(`${prefix}${tuples.join(',\n')};`);
    tuples = [];
    bytes = Buffer.byteLength(prefix);
  };
  for (const row of rows) {
    const values = columns.map((c) => toLiteral(row[c], pgTypes[c], d1Types.get(c)));
    const tuple = `(${values.join(', ')})`;
    const size = Buffer.byteLength(tuple) + 2;
    if (Buffer.byteLength(prefix) + size > MAX_STATEMENT_BYTES) {
      flush();
      statements.push(...splitLongRow(table.name, columns, values, table.primaryKey));
      continue;
    }
    if (tuples.length >= batch || bytes + size > MAX_STATEMENT_BYTES) flush();
    tuples.push(tuple);
    bytes += size;
  }
  flush();
  return { statements, droppedColumns: [...present].filter((c) => !d1Types.has(c)).sort() };
}

async function readExport(dir, table) {
  const rowsFile = join(dir, `${table}.jsonl`);
  if (!existsSync(rowsFile)) return null;
  const rows = (await readFile(rowsFile, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const typesFile = join(dir, `${table}.columns.json`);
  const pgTypes = existsSync(typesFile) ? JSON.parse(await readFile(typesFile, 'utf8')) : {};
  return { rows, pgTypes };
}

export async function transform({ inDir, outDir, batch = 50, tables = loadTables() }) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const keptIds = new Map();
  const manifest = [];
  let fileNumber = 0;
  for (const table of tables) {
    const data = await readExport(inDir, table.name);
    if (!data) continue;
    const { rows, excluded } = filterChildren(table, data.rows, keptIds);
    const files = [];
    const droppedColumns = new Set();
    for (let at = 0; at < rows.length; at += ROWS_PER_FILE) {
      const built = buildStatements(table, rows.slice(at, at + ROWS_PER_FILE), data.pgTypes, batch);
      built.droppedColumns.forEach((c) => droppedColumns.add(c));
      const name = `${String(++fileNumber).padStart(4, '0')}_${table.name}.sql`;
      await writeFile(join(outDir, name), `${FILE_HEADER}${built.statements.join('\n')}\n`);
      files.push(name);
    }
    manifest.push({ table: table.name, rows: rows.length, excludedChildren: excluded, droppedColumns: [...droppedColumns], files });
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function parseArgs(argv) {
  const args = { inDir: '.migration/export', outDir: '.migration/sql', batch: 50 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') args.inDir = argv[++i];
    else if (argv[i] === '--out') args.outDir = argv[++i];
    else if (argv[i] === '--batch') args.batch = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(args.batch) || args.batch < 1) throw new Error('--batch must be a positive integer');
  return { inDir: resolve(args.inDir), outDir: resolve(args.outDir), batch: args.batch };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const manifest = await transform(parseArgs(process.argv.slice(2)));
  for (const t of manifest) {
    const dropped = t.droppedColumns.length ? ` dropped_columns=${t.droppedColumns.join(',')}` : '';
    console.log(`${t.table}: rows=${t.rows} excluded_children=${t.excludedChildren} files=${t.files.length}${dropped}`);
  }
}
