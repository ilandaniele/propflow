// node --test scripts/migrate-to-r2/verify-objects.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildConfig } from './copy-objects.mjs';
import { formatReport, isStoredKey, referencedKeys, verifyObjects } from './verify-objects.mjs';

const ENV = {
  TIGRIS_ENDPOINT: 'https://fly.storage.tigris.dev',
  TIGRIS_ACCESS_KEY_ID: 'tid',
  TIGRIS_SECRET_ACCESS_KEY: 'tsecret',
  STORAGE_BUCKET: 'shared',
  R2_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'rid',
  R2_SECRET_ACCESS_KEY: 'rsecret',
};

function listXml(objects) {
  const contents = objects
    .map((o) => `<Contents><Key>${o.key}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag><Size>${o.size}</Size></Contents>`)
    .join('');
  return `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

/** Tigris lists `tigris`; R2 answers HEAD from `r2` (key -> size). */
function fakeFetch(tigris, r2) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.host.endsWith('tigris.dev')) return new Response(listXml(tigris), { status: 200 });
    assert.equal(init.method, 'HEAD');
    const size = r2[decodeURIComponent(u.pathname).replace(/^\/propflow-files\//, '')];
    if (size === undefined) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: { 'content-length': String(size) } });
  };
}

const run = (tigris, r2, references) =>
  verifyObjects({ ...buildConfig(ENV, {}), fetch: fakeFetch(tigris, r2), references: new Set(references), backoffMs: 0 });

test('stored keys are paths, not URLs or empty values', () => {
  assert.equal(isStoredKey('org/receipts/a.png'), true);
  assert.equal(isStoredKey('https://dl.airtable.com/x.png'), false);
  assert.equal(isStoredKey(''), false);
  assert.equal(isStoredKey(null), false);
});

test('referencedKeys reads every file column of the export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r2-verify-'));
  const rows = [{ photo_url: 'o/t/1.png' }, { photo_url: 'http://x/y.png' }, { photo_url: null }, { photo_url: 'o/t/1.png' }];
  await writeFile(join(dir, 'tenants.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'));
  await writeFile(join(dir, 'unit_images.jsonl'), `${JSON.stringify({ storage_path: 'o/u/2.png' })}\n`);
  assert.deepEqual([...(await referencedKeys(dir))].sort(), ['o/t/1.png', 'o/u/2.png']);
});

test('passes when R2 has every object with the same size', async () => {
  const report = await run([{ key: 'a.png', size: 3 }, { key: 'b.png', size: 4 }], { 'a.png': 3, 'b.png': 4 }, ['a.png']);
  assert.ok(report.ok, formatReport(report));
  assert.deepEqual(report.buckets[0], {
    logical: 'unit-images+tenant-avatars+receipts+incident-photos+task-proofs+contracts',
    objects: 2,
    bytes: 7,
    r2Objects: 2,
    r2Bytes: 7,
    missing: 0,
    sizeDiffers: 0,
    errors: 0,
  });
});

test('fails on a missing or resized object and a missing reference', async () => {
  const report = await run([{ key: 'a.png', size: 3 }, { key: 'b.png', size: 4 }], { 'b.png': 5 }, ['a.png', 'gone.png']);
  assert.equal(report.ok, false);
  assert.equal(report.buckets[0].missing, 1);
  assert.equal(report.buckets[0].sizeDiffers, 1);
  assert.deepEqual(report.references, { total: 2, missing: 1, missingAtSource: 1 });
  assert.doesNotMatch(formatReport(report), /a\.png|b\.png/);
});

test('a reference missing in Tigris and R2 is counted but does not fail', async () => {
  const report = await run([{ key: 'a.png', size: 3 }], { 'a.png': 3 }, ['lost.png']);
  assert.ok(report.ok);
  assert.equal(report.references.missingAtSource, 1);
});
