#!/usr/bin/env node
// W-CF-07 — Inventory of the Postgres data before the D1 migration (read-only).
//
// Usage (DATABASE_URL through `flyctl proxy`, PRIMARY_OWNER_EMAIL set):
//   node scripts/migrate-to-d1/inventory.mjs [--orgs <id,id,...>]
//
// Without --orgs, the legitimate orgs are the owner's plus every org with a
// profile linked to a user. Prints one JSON report to stdout:
//   { ownerOrgId, legitimateOrgIds, orgs[], tables[], legacyBcryptUsers,
//     totalRowsToMigrate, storageRefs[] }
// The owner reviews and approves it (B4); the approved ids go to export.mjs --orgs.
// Every query runs inside one READ ONLY transaction.

import { pathToFileURL } from 'node:url';
import { rowFilter } from './export.mjs';
import { loadTables, PROVENANCE_COLUMNS } from './tables.mjs';
import { filterChildren } from './transform.mjs';

const STORAGE_COLUMN = /(_url|_path|_key)$|^(photos|images|attachments)$/;

async function main() {
  const ownerEmail = process.env.PRIMARY_OWNER_EMAIL;
  if (!process.env.DATABASE_URL || !ownerEmail) throw new Error('DATABASE_URL and PRIMARY_OWNER_EMAIL are required');
  const orgsArg = process.argv.indexOf('--orgs');
  const requestedOrgs = orgsArg > 0 ? process.argv[orgsArg + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const report = await sql.begin('read only', async (tx) => {
      const [owner] = await tx`SELECT org_id FROM profiles WHERE lower(email) = lower(${ownerEmail}) LIMIT 1`;
      if (!owner) throw new Error('owner profile not found');
      const orgs = await tx`
        SELECT o.id, o.name,
          (SELECT count(*)::int FROM profiles p WHERE p.org_id = o.id AND p.user_id IS NOT NULL) AS users
        FROM organizations o ORDER BY o.created_at`;
      const legitimate = requestedOrgs ?? orgs.filter((o) => o.id === owner.org_id || o.users > 0).map((o) => o.id);
      const params = [legitimate, owner.org_id];

      const tables = [];
      const keptIds = new Map();
      const rowsByOrg = new Map();
      const storageRefs = [];
      for (const table of loadTables()) {
        const [exists] = await tx`SELECT to_regclass(${`public.${table.name}`}) AS name`;
        if (!exists.name) continue;
        const columns = new Set(table.columns.map((c) => c.name));
        const [{ total }] = await tx.unsafe(`SELECT count(*)::int AS total FROM "${table.name}"`);
        const keep = [...new Set([...table.primaryKey, ...table.foreignKeys.map((fk) => fk.column)])].map((c) => `"${c}"`).join(', ');
        const rows = await tx.unsafe(`SELECT ${keep} FROM "${table.name}" WHERE ${rowFilter(table)}`, params);
        const { rows: kept, excluded } = filterChildren(table, rows, keptIds);
        const provenance = PROVENANCE_COLUMNS.filter((c) => columns.has(c));
        const [{ crossOrg }] = provenance.length
          ? await tx.unsafe(
              `SELECT count(*)::int AS "crossOrg" FROM "${table.name}" WHERE (${provenance.map((c) => `${c} IS NOT NULL`).join(' OR ')}) AND org_id <> $1::uuid`,
              [owner.org_id],
            )
          : [{ crossOrg: 0 }];
        tables.push({ name: table.name, total, toMigrate: kept.length, excludedCrossOrg: crossOrg, excludedChildren: excluded });

        if (columns.has('org_id')) {
          const perOrg = await tx.unsafe(`SELECT org_id, count(*)::int AS n FROM "${table.name}" GROUP BY org_id`);
          for (const { org_id: org, n } of perOrg) rowsByOrg.set(org, (rowsByOrg.get(org) ?? 0) + n);
        }
        for (const column of table.columns.filter((c) => c.type === 'text' && STORAGE_COLUMN.test(c.name))) {
          const [{ count }] = await tx.unsafe(`SELECT count(*)::int AS count FROM "${table.name}" WHERE "${column.name}" IS NOT NULL`);
          if (count) storageRefs.push({ column: `${table.name}.${column.name}`, count });
        }
      }
      const [{ legacy }] = await tx`SELECT count(*)::int AS legacy FROM users WHERE password_hash LIKE '$2%'`;

      return {
        ownerOrgId: owner.org_id,
        legitimateOrgIds: legitimate,
        orgs: orgs.map((o) => ({ id: o.id, name: o.name, users: o.users, rows: rowsByOrg.get(o.id) ?? 0 })),
        tables,
        legacyBcryptUsers: legacy,
        totalRowsToMigrate: tables.reduce((sum, t) => sum + t.toMigrate, 0),
        storageRefs,
      };
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'inventory failed');
    process.exit(1);
  });
}
