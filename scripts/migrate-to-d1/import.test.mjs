// node --test scripts/migrate-to-d1/import.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTarget } from './d1.mjs';
import { parseArgs, runImport, stateKey } from './import.mjs';

const manifest = [
  { table: 'organizations', files: ['0001_organizations.sql'] },
  { table: 'units', files: ['0002_units.sql', '0003_units.sql'] },
];

describe('parseTarget', () => {
  it('requires --local or --remote and keeps the rest', () => {
    assert.throws(() => parseTarget([]), /--local or --remote/);
    assert.throws(() => parseTarget(['--remote', '--persist-to', 'x']), /--persist-to/);
    const { target, rest } = parseTarget(['--remote', '--db', 'propflow-db-staging', '--sql', 'dir']);
    assert.deepEqual(target, { db: 'propflow-db-staging', remote: true, persistTo: null });
    assert.deepEqual(rest, ['--sql', 'dir']);
  });
});

describe('import', () => {
  it('keeps one state per target and database', () => {
    assert.equal(stateKey({ remote: false, db: 'propflow-db' }), 'local:propflow-db');
    assert.equal(stateKey(parseArgs(['--remote']).target), 'remote:propflow-db');
  });

  it('applies files in manifest order and saves after each one', async () => {
    const applied = [];
    const saves = [];
    const state = {};
    const result = await runImport({
      manifest,
      state,
      key: 'local:db',
      apply: (file) => applied.push(file),
      save: (s) => saves.push([...s['local:db']]),
    });
    assert.deepEqual(applied, ['0001_organizations.sql', '0002_units.sql', '0003_units.sql']);
    assert.deepEqual(saves.at(-1), applied);
    assert.deepEqual(result, { applied: 3, skipped: 0 });
  });

  it('stops at a failing file and resumes after it', async () => {
    const state = { 'remote:db': ['0001_organizations.sql'], 'local:db': ['0002_units.sql'] };
    const failing = runImport({
      manifest,
      state,
      key: 'remote:db',
      apply: (file) => {
        if (file === '0003_units.sql') throw new Error('SQLITE_CONSTRAINT');
      },
      save: () => {},
    });
    await assert.rejects(failing, /0003_units\.sql: SQLITE_CONSTRAINT/);
    assert.deepEqual(state['remote:db'], ['0001_organizations.sql', '0002_units.sql']);

    const applied = [];
    const result = await runImport({ manifest, state, key: 'remote:db', apply: (f) => applied.push(f), save: () => {} });
    assert.deepEqual(applied, ['0003_units.sql']);
    assert.deepEqual(result, { applied: 1, skipped: 2 });
    assert.deepEqual(state['local:db'], ['0002_units.sql']);
  });
});
