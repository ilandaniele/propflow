#!/usr/bin/env node
// W-CF-52 — Checks that D1 holds exactly the exported rows (docs/07 §7.6).
//
// Usage:
//   node scripts/migrate-to-d1/verify.mjs --local [--persist-to <dir>] [--in .migration/export]
//   node scripts/migrate-to-d1/verify.mjs --remote --db propflow-db-staging
//
// The expected side is the export directory of export.mjs (one READ ONLY
// snapshot of Postgres), with the same child filtering as transform.mjs.
// Per table: row count, sha256 of the sorted primary keys, and up to 20 random
// rows compared field by field. Then the business invariants: payments.amount
// sum per org and status, active contracts per org, users with a password.
// Exits 0 only when everything matches. Prints counts and column names only.
// One run reads about every row of D1 once (rows_read is printed).

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTarget, queryD1 } from './d1.mjs';
import { loadTables } from './tables.mjs';
import { filterChildren, quote, readExport, toLiteral } from './transform.mjs';

const SAMPLE_SIZE = 20;

/** A D1 value as the SQLite literal transform.mjs would have written for it. */
export function d1Literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return quote(String(value));
}

function toScaled(value, scale) {
  const [whole, fraction = ''] = String(value).trim().split('.');
  const negative = whole.startsWith('-');
  const digits = BigInt(`${whole.replace(/^[-+]/, '')}${fraction.padEnd(scale, '0')}` || '0');
  return negative ? -digits : digits;
}

/** Exact sum of decimal strings, normalized ("10.50" + "0.5" = "11"). */
export function sumDecimals(values) {
  const scale = Math.max(0, ...values.map((v) => (String(v).split('.')[1] ?? '').length));
  const total = values.reduce((sum, v) => sum + toScaled(v, scale), 0n);
  const sign = total < 0n ? '-' : '';
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

function sha256(lines) {
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

function sample(rows, size, random) {
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

function groupBy(rows, keyOf, valueOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), valueOf(row)]);
  }
  return groups;
}

function sameMap(a, b) {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

async function verifyTable(table, data, query, random) {
  const d1Types = new Map(table.columns.map((c) => [c.name, c.type]));
  const literal = (row, column) => toLiteral(row[column], data.pgTypes[column], d1Types.get(column));
  const keyOf = (row, toText) => table.primaryKey.map((c) => toText(row, c)).join('|');
  const expectedKey = (row) => keyOf(row, literal);
  const actualKey = (row) => keyOf(row, (r, c) => d1Literal(r[c]));

  const picked = sample(data.rows, SAMPLE_SIZE, random);
  const name = `\`${table.name}\``;
  const keys = table.primaryKey.map((c) => `\`${c}\``).join(', ');
  const statements = [`SELECT ${keys} FROM ${name}`];
  if (picked.length) {
    const match = picked.map((row) => `(${table.primaryKey.map((c) => `\`${c}\` = ${literal(row, c)}`).join(' AND ')})`);
    statements.push(`SELECT * FROM ${name} WHERE ${match.join(' OR ')}`);
  }
  const { results, rowsRead } = await query(statements);
  const [actualKeys, actualSample = []] = results;

  const byKey = new Map(actualSample.map((row) => [actualKey(row), row]));
  const columns = table.columns.map((c) => c.name);
  const differentColumns = new Set();
  for (const row of picked) {
    const actual = byKey.get(expectedKey(row));
    for (const column of columns.filter((c) => c in row)) {
      if (!actual || literal(row, column) !== d1Literal(actual[column])) differentColumns.add(column);
    }
  }
  const countOk = actualKeys.length === data.rows.length;
  const idsOk = sha256(data.rows.map(expectedKey)) === sha256(actualKeys.map(actualKey));
  return {
    table: table.name,
    expected: data.rows.length,
    actual: actualKeys.length,
    countOk,
    idsOk,
    sampled: picked.length,
    differentColumns: [...differentColumns].sort(),
    ok: countOk && idsOk && differentColumns.size === 0,
    rowsRead,
  };
}

const INVARIANTS = [
  {
    name: 'payments.amount by org and status',
    table: 'payments',
    sql: 'SELECT `org_id`, `status`, `amount` FROM `payments`',
    summarize: (rows) =>
      new Map(
        [...groupBy(rows, (r) => `${r.org_id}|${r.status}`, (r) => String(r.amount))].map(([key, amounts]) => [key, sumDecimals(amounts)]),
      ),
  },
  {
    name: 'active contracts by org',
    table: 'contracts',
    sql: "SELECT `org_id` FROM `contracts` WHERE `status` = 'active'",
    expectedRows: (rows) => rows.filter((r) => r.status === 'active'),
    summarize: (rows) => new Map([...groupBy(rows, (r) => r.org_id, () => 1)].map(([key, ones]) => [key, ones.length])),
  },
  {
    name: 'users with password_hash',
    table: 'users',
    sql: 'SELECT `id` FROM `users` WHERE `password_hash` IS NOT NULL',
    expectedRows: (rows) => rows.filter((r) => r.password_hash != null),
    summarize: (rows) => new Map([['users', rows.length]]),
  },
];

/** Compares the export directory with D1. `query(statements)` returns { results, rowsRead }. */
export async function verify({ inDir, query, tables = loadTables(), random = Math.random }) {
  const keptIds = new Map();
  const kept = new Map();
  const report = { tables: [], invariants: [], rowsRead: 0 };
  for (const table of tables) {
    const data = await readExport(inDir, table.name);
    if (!data) continue;
    const { rows } = filterChildren(table, data.rows, keptIds);
    kept.set(table.name, rows);
    const result = await verifyTable(table, { rows, pgTypes: data.pgTypes }, query, random);
    report.rowsRead += result.rowsRead;
    report.tables.push(result);
  }
  for (const invariant of INVARIANTS.filter((i) => kept.has(i.table))) {
    const { results, rowsRead } = await query([invariant.sql]);
    report.rowsRead += rowsRead;
    const rows = kept.get(invariant.table);
    const expected = invariant.summarize(invariant.expectedRows ? invariant.expectedRows(rows) : rows);
    report.invariants.push({ name: invariant.name, groups: expected.size, ok: sameMap(expected, invariant.summarize(results[0])) });
  }
  report.ok = report.tables.every((t) => t.ok) && report.invariants.every((i) => i.ok);
  return report;
}

export function formatReport(report) {
  const lines = report.tables.map((t) => {
    const columns = t.differentColumns.length ? ` columns=${t.differentColumns.join(',')}` : '';
    return `${t.ok ? 'OK  ' : 'FAIL'} ${t.table}: expected=${t.expected} d1=${t.actual} ids=${t.idsOk ? 'same' : 'different'} sampled=${t.sampled}${columns}`;
  });
  lines.push(...report.invariants.map((i) => `${i.ok ? 'OK  ' : 'FAIL'} invariant ${i.name} (groups=${i.groups})`));
  lines.push(`rows_read=${report.rowsRead}`, report.ok ? 'verify: OK' : 'verify: FAILED');
  return lines.join('\n');
}

export function parseArgs(argv) {
  const { target, rest } = parseTarget(argv);
  let inDir = '.migration/export';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--in') inDir = rest[++i];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  return { target, inDir: resolve(inDir) };
}

async function main() {
  const { target, inDir } = parseArgs(process.argv.slice(2));
  const report = await verify({ inDir, query: (statements) => queryD1(target, statements) });
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'verify failed');
    process.exit(1);
  });
}
