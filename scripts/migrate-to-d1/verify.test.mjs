// node --test scripts/migrate-to-d1/verify.test.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { parseSchema, topologicalOrder } from './tables.mjs';
import { transform } from './transform.mjs';
import { d1Literal, formatReport, sumDecimals, verify } from './verify.mjs';

const SCHEMA = `CREATE TABLE \`organizations\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`name\` text NOT NULL,
\t\`created_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`payments\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`org_id\` text NOT NULL,
\t\`status\` text NOT NULL,
\t\`amount\` text NOT NULL,
\t\`paid\` integer NOT NULL,
\tFOREIGN KEY (\`org_id\`) REFERENCES \`organizations\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`daily\` (
\t\`org_id\` text NOT NULL,
\t\`day\` text NOT NULL,
\t\`total\` integer,
\tPRIMARY KEY(\`org_id\`, \`day\`)
);
`;

const tables = topologicalOrder(parseSchema(SCHEMA));

const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'd1-verify-'));
  const inDir = join(dir, 'export');
  const outDir = join(dir, 'sql');
  await mkdir(inDir);
  await writeFile(join(inDir, 'organizations.jsonl'), jsonl([{ id: 'o1', name: "O'Brien", created_at: '2024-03-01 10:00:00.123-05' }]));
  await writeFile(join(inDir, 'organizations.columns.json'), '{"created_at":"timestamp with time zone"}');
  await writeFile(
    join(inDir, 'payments.jsonl'),
    jsonl([
      { id: 'p1', org_id: 'o1', status: 'approved', amount: '10.50', paid: true },
      { id: 'p2', org_id: 'o1', status: 'approved', amount: '0.50', paid: false },
      { id: 'p3', org_id: 'gone', status: 'approved', amount: '99', paid: true },
    ]),
  );
  await writeFile(join(inDir, 'payments.columns.json'), '{"amount":"numeric","paid":"boolean"}');
  await writeFile(join(inDir, 'daily.jsonl'), jsonl([{ org_id: 'o1', day: '2024-03-01', total: 3 }]));
  await writeFile(join(inDir, 'daily.columns.json'), '{"day":"date"}');

  const manifest = await transform({ inDir, outDir, batch: 50, tables });
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const file of manifest.flatMap((t) => t.files)) db.exec(await readFile(join(outDir, file), 'utf8'));
  const query = (statements) => ({ results: statements.map((s) => db.prepare(s).all()), rowsRead: 0 });
  return { inDir, db, query };
}

const verifyWith = ({ inDir, query }) => verify({ inDir, query, tables, random: () => 0 });

describe('verify helpers', () => {
  it('sums decimal strings exactly', () => {
    assert.equal(sumDecimals(['10.50', '0.5']), '11');
    assert.equal(sumDecimals(['0.1', '0.2']), '0.3');
    assert.equal(sumDecimals(['-1.25', '1']), '-0.25');
    assert.equal(sumDecimals([]), '0');
  });

  it('writes D1 values as the literals transform produced', () => {
    assert.equal(d1Literal(null), 'NULL');
    assert.equal(d1Literal(1709305200123), '1709305200123');
    assert.equal(d1Literal("O'Brien"), "'O''Brien'");
  });
});

describe('verify', () => {
  it('passes when D1 holds exactly the exported rows', async () => {
    const report = await verifyWith(await setup());
    assert.ok(report.ok, formatReport(report));
    assert.deepEqual(
      report.tables.map((t) => [t.table, t.expected, t.actual]),
      [['daily', 1, 1], ['organizations', 1, 1], ['payments', 2, 2]],
    );
    assert.deepEqual(report.invariants.map((i) => i.name), ['payments.amount by org and status']);
  });

  it('fails on a changed field and names only the column', async () => {
    const env = await setup();
    env.db.exec("UPDATE payments SET amount = '10.49' WHERE id = 'p1'");
    const report = await verifyWith(env);
    const payments = report.tables.find((t) => t.table === 'payments');
    assert.equal(report.ok, false);
    assert.deepEqual(payments.differentColumns, ['amount']);
    assert.equal(report.invariants[0].ok, false);
    assert.doesNotMatch(formatReport(report), /10\.49/);
  });

  it('fails on a missing or extra row', async () => {
    const env = await setup();
    env.db.exec("DELETE FROM daily; INSERT INTO organizations VALUES ('o2', 'x', 0)");
    const report = await verifyWith(env);
    const failed = report.tables.filter((t) => !t.ok).map((t) => [t.table, t.countOk, t.idsOk]);
    assert.deepEqual(failed, [['daily', false, false], ['organizations', false, false]]);
  });
});
