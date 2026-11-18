// node --test scripts/migrate-to-d1/export.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs, rowFilter } from './export.mjs';
import { loadTables } from './tables.mjs';

const table = (name) => loadTables().find((t) => t.name === name);
const ORG = '11111111-1111-4111-8111-111111111111';

describe('rowFilter', () => {
  it('keeps approved orgs and their users', () => {
    assert.equal(rowFilter(table('organizations')), 'id = ANY($1::uuid[])');
    assert.match(rowFilter(table('users')), /FROM profiles WHERE org_id = ANY\(\$1::uuid\[\]\)/);
  });

  it('leaves out Airtable copies outside the owner org', () => {
    assert.equal(
      rowFilter(table('tenants')),
      'org_id = ANY($1::uuid[]) AND NOT ((airtable_external_id IS NOT NULL) AND org_id <> $2::uuid)',
    );
  });

  it('filters by org alone without provenance columns, and keeps tables without org', () => {
    assert.equal(rowFilter(table('agent_events')), 'org_id = ANY($1::uuid[])');
    assert.equal(rowFilter(table('accounts')), 'TRUE');
  });
});

describe('parseArgs', () => {
  it('requires approved org ids', () => {
    assert.throws(() => parseArgs([]), /--orgs/);
    assert.throws(() => parseArgs(['--orgs', 'not-a-uuid']), /--orgs/);
    assert.deepEqual(parseArgs(['--orgs', ` ${ORG} ,`]).orgs, [ORG]);
  });
});
