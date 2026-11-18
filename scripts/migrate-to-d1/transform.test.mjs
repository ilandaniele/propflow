// node --test scripts/migrate-to-d1/transform.test.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadTables, parseSchema, topologicalOrder } from './tables.mjs';
import { buildStatements, filterChildren, MAX_STATEMENT_BYTES, quote, toEpochMs, toLiteral, transform } from './transform.mjs';

const SCHEMA = `CREATE TABLE \`units\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`org_id\` text NOT NULL,
\tFOREIGN KEY (\`org_id\`) REFERENCES \`organizations\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`organizations\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`name\` text NOT NULL,
\t\`created_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`visits\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`unit_id\` text NOT NULL,
\t\`parent_id\` text,
\tFOREIGN KEY (\`unit_id\`) REFERENCES \`units\`(\`id\`) ON UPDATE no action ON DELETE cascade,
\tFOREIGN KEY (\`parent_id\`) REFERENCES \`visits\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`daily\` (
\t\`org_id\` text NOT NULL,
\t\`day\` text NOT NULL,
\tPRIMARY KEY(\`org_id\`, \`day\`)
);
`;

const tables = () => topologicalOrder(parseSchema(SCHEMA));
const byName = (name) => tables().find((t) => t.name === name);

describe('tables', () => {
  it('parses columns, primary keys and foreign keys', () => {
    const daily = byName('daily');
    assert.deepEqual(daily.primaryKey, ['org_id', 'day']);
    assert.deepEqual(byName('units').foreignKeys, [{ column: 'org_id', table: 'organizations', references: 'id' }]);
    assert.deepEqual(byName('organizations').columns.at(-1), { name: 'created_at', type: 'integer' });
  });

  it('adds the columns of later ALTER TABLE ADD statements', () => {
    const altered = parseSchema(`${SCHEMA}--> statement-breakpoint
ALTER TABLE \`units\` ADD \`unit_type\` text;--> statement-breakpoint
ALTER TABLE \`units\` ADD \`rooms\` integer;`);
    assert.deepEqual(altered.find((t) => t.name === 'units').columns.slice(-2), [
      { name: 'unit_type', type: 'text' },
      { name: 'rooms', type: 'integer' },
    ]);
  });

  it('orders parents before children, ignoring self references', () => {
    const names = tables().map((t) => t.name);
    assert.ok(names.indexOf('organizations') < names.indexOf('units'));
    assert.ok(names.indexOf('units') < names.indexOf('visits'));
  });

  it('throws on a foreign key cycle', () => {
    const a = { name: 'a', foreignKeys: [{ column: 'b_id', table: 'b' }] };
    const b = { name: 'b', foreignKeys: [{ column: 'a_id', table: 'a' }] };
    assert.throws(() => topologicalOrder([a, b]), /cycle/);
  });

  it('reads the real D1 schema without sessions or rate limits', () => {
    const names = loadTables().map((t) => t.name);
    assert.equal(names[0], 'organizations');
    assert.ok(names.includes('payments'));
    assert.ok(!names.includes('sessions') && !names.includes('rate_limits'));
    const tenantColumns = loadTables().find((t) => t.name === 'tenants').columns.map((c) => c.name);
    assert.ok(tenantColumns.includes('dni'), 'columns added by later migrations are read');
  });
});

describe('toLiteral', () => {
  it('converts timestamptz with any offset to epoch ms', () => {
    const utc = Date.UTC(2024, 2, 1, 15, 0, 0, 123);
    assert.equal(toEpochMs('2024-03-01 10:00:00.123456-05'), utc);
    assert.equal(toEpochMs('2024-03-01T10:00:00.123-05:00'), utc);
    assert.equal(toEpochMs('2024-03-01 20:30:00.123+0530'), utc);
    assert.equal(toEpochMs('2024-03-01T15:00:00.123Z'), utc);
    assert.equal(toLiteral('2024-03-01 15:00:00.123', 'timestamp without time zone', 'integer'), String(utc));
    assert.throws(() => toEpochMs('not a date'));
  });

  it('keeps numeric decimals exactly as text', () => {
    assert.equal(toLiteral('1234.50', 'numeric', 'text'), "'1234.50'");
    assert.equal(toLiteral('0.000000000000000001', 'numeric', 'text'), "'0.000000000000000001'");
  });

  it('serializes jsonb, arrays and objects as JSON text with quotes and unicode', () => {
    assert.equal(toLiteral({ name: "O'Brien", city: 'Cañete 🏠' }, 'jsonb', 'text'), `'{"name":"O''Brien","city":"Cañete 🏠"}'`);
    assert.equal(toLiteral('plain', 'jsonb', 'text'), `'"plain"'`);
    assert.equal(toLiteral(['a', 'b'], 'ARRAY', 'text'), `'["a","b"]'`);
  });

  it('maps booleans, dates, integers and NULLs', () => {
    assert.equal(toLiteral(true, 'boolean', 'integer'), '1');
    assert.equal(toLiteral(false, 'boolean', 'integer'), '0');
    assert.equal(toLiteral('2024-03-01', 'date', 'text'), "'2024-03-01'");
    assert.equal(toLiteral('9007199254740993', 'bigint', 'integer'), '9007199254740993');
    assert.equal(toLiteral(null, 'text', 'text'), 'NULL');
    assert.equal(toLiteral(undefined, 'jsonb', 'text'), 'NULL');
  });

  it('falls back to the value and the D1 type without a pg type', () => {
    assert.equal(toLiteral(42, undefined, 'integer'), '42');
    assert.equal(toLiteral('2024-03-01T00:00:00Z', undefined, 'integer'), String(Date.UTC(2024, 2, 1)));
    assert.equal(toLiteral('x', undefined, 'text'), "'x'");
  });

  it('escapes single quotes and rejects NUL', () => {
    assert.equal(quote("it's ''quoted''"), "'it''s ''''quoted'''''");
    assert.throws(() => quote('a\0b'), /NUL/);
  });
});

describe('filterChildren', () => {
  it('drops rows pointing at rows that are not migrated, including self references', () => {
    const kept = new Map([['units', new Set(['u1'])]]);
    const rows = [
      { id: 'v1', unit_id: 'u1', parent_id: null },
      { id: 'v2', unit_id: 'gone', parent_id: null },
      { id: 'v3', unit_id: 'u1', parent_id: 'v2' },
      { id: 'v4', unit_id: 'u1', parent_id: 'v1' },
    ];
    const result = filterChildren(byName('visits'), rows, kept);
    assert.deepEqual(result.rows.map((r) => r.id), ['v1', 'v4']);
    assert.equal(result.excluded, 2);
    assert.deepEqual([...kept.get('visits')], ['v1', 'v4']);
  });
});

describe('buildStatements', () => {
  const org = byName('organizations');
  const rows = [1, 2, 3].map((n) => ({ id: `o${n}`, name: `Org ${n}`, created_at: '2024-01-01 00:00:00+00', legacy: 'x' }));
  const types = { id: 'uuid', name: 'text', created_at: 'timestamp with time zone', legacy: 'text' };

  it('batches rows and reports columns D1 does not have', () => {
    const { statements, droppedColumns } = buildStatements(org, rows, types, 2);
    assert.equal(statements.length, 2);
    assert.match(statements[0], /^INSERT INTO `organizations` \(`id`, `name`, `created_at`\) VALUES\n\('o1', 'Org 1', 1704067200000\),\n\('o2'/);
    assert.deepEqual(droppedColumns, ['legacy']);
  });

  it('splits a row longer than one statement into an insert and appends', () => {
    const big = 'é'.repeat(MAX_STATEMENT_BYTES);
    const { statements } = buildStatements(org, [{ id: 'o1', name: big, created_at: '2024-01-01T00:00:00Z' }], types, 50);
    assert.match(statements[0], /\('o1', '', 1704067200000\);$/);
    assert.ok(statements.length > 2);
    assert.ok(statements.every((s) => Buffer.byteLength(s) < 100_000));
    const appended = statements.slice(1).map((s) => s.match(/\|\| '(.*)' WHERE/)[1]).join('');
    assert.equal(appended, big);
  });
});

describe('transform', () => {
  it('writes ordered files and a manifest from the export directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'd1-transform-'));
    const inDir = join(dir, 'export');
    const outDir = join(dir, 'sql');
    await mkdir(inDir);
    await writeFile(join(inDir, 'units.jsonl'), '{"id":"u1","org_id":"o1"}\n{"id":"u2","org_id":"other"}\n');
    await writeFile(join(inDir, 'organizations.jsonl'), '{"id":"o1","name":"A","created_at":"2024-01-01T00:00:00Z"}\n');
    await writeFile(join(inDir, 'organizations.columns.json'), '{"created_at":"timestamp with time zone"}');

    const manifest = await transform({ inDir, outDir, batch: 50, tables: tables() });

    assert.deepEqual(manifest.map((m) => [m.table, m.rows, m.excludedChildren]), [['organizations', 1, 0], ['units', 1, 1]]);
    assert.deepEqual(await readdir(outDir), ['0001_organizations.sql', '0002_units.sql', 'manifest.json']);
    const units = await readFile(join(outDir, '0002_units.sql'), 'utf8');
    assert.equal(units, "PRAGMA defer_foreign_keys = ON;\nINSERT INTO `units` (`id`, `org_id`) VALUES\n('u1', 'o1');\n");
  });
});
