// W-CF-07 — Tables to migrate from Postgres to D1, read from the D1 schema itself
// (every migration of src/lib/db/migrations-d1, in journal order), in foreign-key (topological) order.
// Shared by inventory.mjs, export.mjs, transform.mjs, import.mjs and verify.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../src/lib/db/migrations-d1/', import.meta.url));

/** Not migrated: sessions and tokens expire anyway; rate_limits is D1-only runtime state. */
export const SKIPPED_TABLES = new Set(['sessions', 'verification_tokens', 'rate_limits']);

/** Columns that mark a row as a copy made from Airtable (the cross-org copies of F-01). */
export const PROVENANCE_COLUMNS = ['airtable_external_id', 'airtable_id'];

const CREATE_TABLE = /CREATE TABLE `([a-z0-9_]+)` \(\n([\s\S]*?)\n\);/g;
const COLUMN = /^\t`([a-z0-9_]+)` (text|integer|real|blob|numeric)\b(.*)$/;
const FOREIGN_KEY = /^\tFOREIGN KEY \(`([a-z0-9_]+)`\) REFERENCES `([a-z0-9_]+)`\(`([a-z0-9_]+)`\)/;
const COMPOSITE_PK = /^\tPRIMARY KEY\((.+)\)/;
const ADD_COLUMN = /ALTER TABLE `([a-z0-9_]+)` ADD `([a-z0-9_]+)` (text|integer|real|blob|numeric)\b/g;

/** Parses the CREATE TABLE and ALTER TABLE ADD statements of drizzle sqlite migrations. */
export function parseSchema(sql) {
  const tables = [];
  sql = sql.replace(/\r\n/g, '\n');
  for (const [, name, body] of sql.matchAll(CREATE_TABLE)) {
    const table = { name, columns: [], primaryKey: [], foreignKeys: [] };
    for (const line of body.split('\n')) {
      const column = line.match(COLUMN);
      const fk = line.match(FOREIGN_KEY);
      const pk = line.match(COMPOSITE_PK);
      if (column) {
        table.columns.push({ name: column[1], type: column[2] });
        if (/PRIMARY KEY/.test(column[3])) table.primaryKey.push(column[1]);
      } else if (fk) {
        table.foreignKeys.push({ column: fk[1], table: fk[2], references: fk[3] });
      } else if (pk) {
        table.primaryKey.push(...[...pk[1].matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]));
      }
    }
    tables.push(table);
  }
  for (const [, name, column, type] of sql.matchAll(ADD_COLUMN)) {
    tables.find((t) => t.name === name)?.columns.push({ name: column, type });
  }
  return tables;
}

/** Every migration file, concatenated in journal order. */
export function readMigrationsSql(dir = MIGRATIONS_DIR) {
  const { entries } = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
  return [...entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => readFileSync(join(dir, `${tag}.sql`), 'utf8'))
    .join('\n--> statement-breakpoint\n');
}

/** Parents before children. Self references are ignored; any other cycle throws. */
export function topologicalOrder(tables) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const done = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (table) => {
    if (done.has(table.name)) return;
    if (visiting.has(table.name)) throw new Error(`foreign key cycle at ${table.name}`);
    visiting.add(table.name);
    for (const fk of table.foreignKeys) {
      const parent = byName.get(fk.table);
      if (parent && parent.name !== table.name) visit(parent);
    }
    visiting.delete(table.name);
    done.add(table.name);
    order.push(table);
  };
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) visit(table);
  return order;
}

/** Tables to migrate, in import order. */
export function loadTables(sql = readMigrationsSql()) {
  return topologicalOrder(parseSchema(sql)).filter((t) => !SKIPPED_TABLES.has(t.name));
}
