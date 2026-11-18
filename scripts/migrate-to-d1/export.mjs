#!/usr/bin/env node
// W-CF-51 — Exports the Postgres rows to migrate, read-only.
//
// Usage (DATABASE_URL through `flyctl proxy`):
//   node scripts/migrate-to-d1/export.mjs --orgs <id,id,...> [--out .migration/export]
//
// --orgs is the list of legitimate orgs the owner approved from the inventory
// report (W-CF-07); the owner's org comes from PRIMARY_OWNER_EMAIL. Airtable
// copies in any other org are left out. Children of left-out rows are dropped
// later by transform.mjs.
// Writes <table>.jsonl and <table>.columns.json per table. Runs every query
// inside one READ ONLY transaction. Prints counts only.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTables, PROVENANCE_COLUMNS } from './tables.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** WHERE clause (with $1 = legitimate org ids, $2 = owner org id) choosing the rows of one table to migrate. */
export function rowFilter(table) {
  const columns = new Set(table.columns.map((c) => c.name));
  if (table.name === 'organizations') return 'id = ANY($1::uuid[])';
  if (table.name === 'users') return 'id IN (SELECT user_id FROM profiles WHERE org_id = ANY($1::uuid[]))';
  if (!columns.has('org_id')) return 'TRUE';
  const provenance = PROVENANCE_COLUMNS.filter((c) => columns.has(c));
  const legitimate = 'org_id = ANY($1::uuid[])';
  if (!provenance.length) return legitimate;
  const copied = provenance.map((c) => `${c} IS NOT NULL`).join(' OR ');
  return `${legitimate} AND NOT ((${copied}) AND org_id <> $2::uuid)`;
}

export function parseArgs(argv) {
  const args = { out: '.migration/export', orgs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--orgs') args.orgs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.orgs.length || !args.orgs.every((id) => UUID.test(id))) throw new Error('--orgs must list the approved org ids');
  return { out: resolve(args.out), orgs: args.orgs };
}

async function main() {
  const { out, orgs } = parseArgs(process.argv.slice(2));
  const ownerEmail = process.env.PRIMARY_OWNER_EMAIL;
  if (!process.env.DATABASE_URL || !ownerEmail) throw new Error('DATABASE_URL and PRIMARY_OWNER_EMAIL are required');

  const { default: postgres } = await import('postgres');
  const raw = { to: 25, from: [1082, 1114, 1184], serialize: (x) => x, parse: (x) => x };
  const sql = postgres(process.env.DATABASE_URL, { max: 1, types: { rawDates: raw }, connection: { TimeZone: 'UTC', DateStyle: 'ISO' } });
  await mkdir(out, { recursive: true });
  try {
    await sql.begin('read only', async (tx) => {
      const [owner] = await tx`SELECT org_id FROM profiles WHERE lower(email) = lower(${ownerEmail}) LIMIT 1`;
      if (!owner) throw new Error('owner profile not found');
      if (!orgs.includes(owner.org_id)) throw new Error("--orgs must include the owner's org");

      for (const table of loadTables()) {
        const types = await tx`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table.name}`;
        if (!types.length) {
          console.error(`${table.name}: not in postgres, skipped`);
          continue;
        }
        const orderBy = table.primaryKey.map((c) => `"${c}"`).join(', ');
        const rows = await tx.unsafe(`SELECT * FROM "${table.name}" WHERE ${rowFilter(table)} ORDER BY ${orderBy}`, [orgs, owner.org_id]);
        await writeFile(join(out, `${table.name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
        await writeFile(join(out, `${table.name}.columns.json`), JSON.stringify(Object.fromEntries(types.map((t) => [t.column_name, t.data_type]))));
        console.error(`${table.name}: ${rows.length}`);
      }
    });
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'export failed');
    process.exit(1);
  });
}
