// Runs `wrangler d1 execute` against a local or remote D1 database.
// Used by import.mjs and verify.mjs. Never prints SQL or row data.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const wranglerBin = () => join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

/** Parses the target flags shared by import.mjs and verify.mjs. */
export function parseTarget(argv, defaults = {}) {
  const target = { db: 'propflow-db', remote: null, persistTo: null, ...defaults };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--local') target.remote = false;
    else if (argv[i] === '--remote') target.remote = true;
    else if (argv[i] === '--db') target.db = argv[++i];
    else if (argv[i] === '--persist-to') target.persistTo = argv[++i];
    else rest.push(argv[i]);
  }
  if (target.remote === null) throw new Error('choose --local or --remote');
  if (target.remote && target.persistTo) throw new Error('--persist-to only works with --local');
  return { target, rest };
}

function targetArgs({ db, remote, persistTo }) {
  return [db, remote ? '--remote' : '--local', ...(persistTo ? ['--persist-to', persistTo] : []), '--yes'];
}

function execute(target, args) {
  const result = spawnSync(process.execPath, [wranglerBin(), 'd1', 'execute', ...targetArgs(target), ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) {
    const reason = `${result.stderr ?? ''}${result.stdout ?? ''}`.match(/SQLITE_\w+|D1_\w+|\[ERROR\][^\n]{0,80}/)?.[0];
    throw new Error(`wrangler d1 execute failed${reason ? `: ${reason}` : ''}`);
  }
  return result.stdout;
}

/** Applies one .sql file. */
export function executeFile(target, file) {
  execute(target, ['--file', file]);
}

/** Runs read-only statements and returns `{ results, rowsRead }` with one result set per statement. */
export function queryD1(target, statements) {
  const output = JSON.parse(execute(target, ['--json', '--command', statements.join(';\n')]));
  return {
    results: output.map((r) => r.results ?? []),
    rowsRead: output.reduce((sum, r) => sum + (r.meta?.rows_read ?? 0), 0),
  };
}
