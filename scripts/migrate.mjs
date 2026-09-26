#!/usr/bin/env node
// Applies pending SQL migrations from src/lib/db/migrations (or MIGRATIONS_DIR)
// in filename order. Runs as the Fly `release_command`, before new machines
// start, so code never ships ahead of its schema. A failure aborts the deploy
// and leaves the previous release running.
//
// Tracking: public.schema_migrations(filename). On a database that predates
// this runner (organizations exists, tracking table does not), the files that
// were applied by hand before automation (BASELINE_FILES) are recorded as
// applied without running them.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILES = [
  '0000_baseline.sql',
  '0001_missing_airtable_tables.sql',
  '0002_tenant_statement_view.sql',
];

const LOCK_KEY = 727_001; // pg_advisory_lock key for this runner

/** Pure: which files still need to run, in order. */
export function pendingMigrations(files, applied) {
  const done = new Set(applied);
  return files
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .filter((f) => !done.has(f));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set');
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = process.env.MIGRATIONS_DIR ?? join(here, '..', 'src', 'lib', 'db', 'migrations');

  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;

    const [{ tracked }] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS tracked`;
    if (!tracked) {
      await sql`
        CREATE TABLE public.schema_migrations (
          filename   text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`;
      const [{ existing }] = await sql`SELECT to_regclass('public.organizations') IS NOT NULL AS existing`;
      if (existing) {
        for (const f of BASELINE_FILES) {
          await sql`INSERT INTO public.schema_migrations (filename) VALUES (${f}) ON CONFLICT DO NOTHING`;
        }
        console.log('[migrate] existing database: recorded baseline files as applied');
      }
    }

    const applied = (await sql`SELECT filename FROM public.schema_migrations`).map((r) => r.filename);
    const todo = pendingMigrations(readdirSync(dir), applied);
    if (todo.length === 0) {
      console.log('[migrate] up to date');
      return;
    }
    for (const file of todo) {
      const body = readFileSync(join(dir, file), 'utf8');
      console.log(`[migrate] applying ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO public.schema_migrations (filename) VALUES (${file})`;
      });
    }
    console.log(`[migrate] applied ${todo.length} migration(s)`);
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[migrate] failed:', err?.message ?? err);
    process.exit(1);
  });
}
