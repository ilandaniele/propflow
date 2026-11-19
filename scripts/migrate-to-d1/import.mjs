#!/usr/bin/env node
// W-CF-52 — Applies the SQL files of transform.mjs to D1, in manifest order.
//
// Usage:
//   node scripts/migrate-to-d1/import.mjs --local [--persist-to <dir>] [--db propflow-db]
//   node scripts/migrate-to-d1/import.mjs --remote --db propflow-db-staging
//   options: [--sql .migration/sql] [--state .migration/import-state.json]
//
// Resumable: each applied file is recorded in the state file under
// "<local|remote>:<db>", and a new run skips it. A run stops at the first
// failing file; check whether part of that file landed before running again.
// Prints file names and counts only.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeFile, parseTarget } from './d1.mjs';

export function parseArgs(argv) {
  const { target, rest } = parseTarget(argv);
  const args = { sqlDir: '.migration/sql', stateFile: '.migration/import-state.json' };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--sql') args.sqlDir = rest[++i];
    else if (rest[i] === '--state') args.stateFile = rest[++i];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  return { target, sqlDir: resolve(args.sqlDir), stateFile: resolve(args.stateFile) };
}

export const stateKey = ({ remote, db }) => `${remote ? 'remote' : 'local'}:${db}`;

/**
 * Applies every manifest file not yet recorded as done, saving the state after
 * each one. `apply(file)` throws on failure. Returns { applied, skipped }.
 */
export async function runImport({ manifest, state, key, apply, save }) {
  const done = new Set(state[key] ?? []);
  let applied = 0;
  let skipped = 0;
  for (const file of manifest.flatMap((t) => t.files)) {
    if (done.has(file)) {
      skipped++;
      continue;
    }
    try {
      await apply(file);
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : 'failed'}`);
    }
    done.add(file);
    state[key] = [...done];
    await save(state);
    applied++;
  }
  return { applied, skipped };
}

async function main() {
  const { target, sqlDir, stateFile } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(sqlDir, 'manifest.json'), 'utf8'));
  const state = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : {};
  const total = manifest.reduce((sum, t) => sum + t.files.length, 0);
  const result = await runImport({
    manifest,
    state,
    key: stateKey(target),
    apply: (file) => {
      console.error(`applying ${file}`);
      executeFile(target, join(sqlDir, file));
    },
    save: (next) => writeFile(stateFile, `${JSON.stringify(next, null, 2)}\n`),
  });
  console.log(`files=${total} applied=${result.applied} skipped=${result.skipped}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'import failed');
    console.error('Check whether part of that file landed in D1 before running again.');
    process.exit(1);
  });
}
