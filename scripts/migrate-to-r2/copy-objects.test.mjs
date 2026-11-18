import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfig,
  parseArgs,
  parseListXml,
  resolveSourceBucket,
  runCopy,
  shouldCopy,
} from './copy-objects.mjs';

const ENV = {
  TIGRIS_ENDPOINT: 'https://fly.storage.tigris.dev',
  TIGRIS_ACCESS_KEY_ID: 'tid',
  TIGRIS_SECRET_ACCESS_KEY: 'tsecret',
  TIGRIS_BUCKET_UNIT_IMAGES: 'src-unit-images',
  TIGRIS_BUCKET_TENANT_AVATARS: 'src-tenant-avatars',
  TIGRIS_BUCKET_RECEIPTS: 'src-receipts',
  TIGRIS_BUCKET_INCIDENT_PHOTOS: 'src-incident-photos',
  TIGRIS_BUCKET_TASK_PROOFS: 'src-task-proofs',
  TIGRIS_BUCKET_CONTRACTS: 'src-contracts',
  R2_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'rid',
  R2_SECRET_ACCESS_KEY: 'rsecret',
};

function listXml(objects, nextToken) {
  const contents = objects
    .map(
      (o) =>
        `<Contents><Key>${o.key}</Key><LastModified>${o.lastModified}</LastModified>` +
        `<ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size></Contents>`
    )
    .join('');
  const trunc = nextToken
    ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${nextToken}</NextContinuationToken>`
    : '<IsTruncated>false</IsTruncated>';
  return `<?xml version="1.0"?><ListBucketResult>${trunc}${contents}</ListBucketResult>`;
}

/**
 * Fake Tigris + R2. `pages` is an array of object arrays for the single source bucket;
 * `r2` maps R2 object keys to {size, etag}; `failGet` is a set of source keys whose GET returns 500.
 */
function fakeStorage({ pages, r2 = {}, failGet = new Set() }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, host: u.host, path: decodeURIComponent(u.pathname), query: u.searchParams });
    if (u.host.endsWith('tigris.dev')) {
      if (u.searchParams.get('list-type') === '2') {
        const token = u.searchParams.get('continuation-token');
        const idx = token ? Number(token.replace('t', '')) : 0;
        const next = idx + 1 < pages.length ? `t${idx + 1}` : undefined;
        return new Response(listXml(pages[idx], next), { status: 200 });
      }
      const key = decodeURIComponent(u.pathname.slice(1));
      if (failGet.has(key)) return new Response('boom', { status: 500 });
      const obj = pages.flat().find((o) => o.key === key);
      return new Response(new Uint8Array(obj.size), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    const r2Key = decodeURIComponent(u.pathname).replace(/^\/propflow-files\//, '');
    if (method === 'HEAD') {
      const hit = r2[r2Key];
      if (!hit) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { 'content-length': String(hit.size), etag: `"${hit.etag}"` } });
    }
    if (method === 'PUT') {
      r2[r2Key] = { size: init.body.byteLength, contentType: new Headers(init.headers).get('content-type') };
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 400 });
  };
  return { fetch, calls, r2 };
}

function ctxFor(fake, extra = {}) {
  const config = buildConfig(ENV, { bucket: 'receipts' });
  return { ...config, fetch: fake.fetch, backoffMs: 0, ...extra };
}

const obj = (key, size, lastModified = '2026-01-01T00:00:00.000Z', etag = 'abc') => ({ key, size, lastModified, etag });

test('resolveSourceBucket follows the old precedence', () => {
  assert.equal(resolveSourceBucket('receipts', { TIGRIS_BUCKET_RECEIPTS: 'a', STORAGE_BUCKET: 'b' }), 'a');
  assert.equal(resolveSourceBucket('receipts', { STORAGE_BUCKET: 'b' }), 'b');
  assert.equal(resolveSourceBucket('receipts', {}), 'receipts');
});

test('buildConfig lists a Tigris bucket shared by several logical buckets once', () => {
  const env = { ...ENV, STORAGE_BUCKET: 'shared' };
  delete env.TIGRIS_BUCKET_RECEIPTS;
  delete env.TIGRIS_BUCKET_CONTRACTS;
  const { buckets } = buildConfig(env, {});
  assert.equal(buckets.length, 5);
  assert.deepEqual(buckets.find((b) => b.physical === 'shared'), { logical: 'receipts+contracts', physical: 'shared' });
});

test('parseArgs validates flags', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--bucket', 'receipts']).bucket, 'receipts');
  assert.throws(() => parseArgs(['--since', 'nope']), /ISO/);
  assert.throws(() => parseArgs(['--bucket', 'nope']), /--bucket/);
});

test('parseListXml reads objects, truncation and token', () => {
  const page = parseListXml(listXml([obj('a&amp;b.png', 10)], 'tok'));
  assert.deepEqual(page.objects, [{ key: 'a&b.png', size: 10, lastModified: '2026-01-01T00:00:00.000Z', etag: 'abc' }]);
  assert.equal(page.isTruncated, true);
  assert.equal(page.nextToken, 'tok');
  assert.equal(parseListXml(listXml([])).isTruncated, false);
});

test('shouldCopy compares size and single-part ETags', () => {
  assert.equal(shouldCopy({ size: 5, etag: 'a' }, null), true);
  assert.equal(shouldCopy({ size: 5, etag: 'a' }, { size: 6, etag: 'a' }), true);
  assert.equal(shouldCopy({ size: 5, etag: 'a' }, { size: 5, etag: 'A' }), false);
  assert.equal(shouldCopy({ size: 5, etag: 'a' }, { size: 5, etag: 'b' }), true);
  assert.equal(shouldCopy({ size: 5, etag: 'a-2' }, { size: 5, etag: 'b' }), false);
});

test('paginates the listing and copies every page', async () => {
  const fake = fakeStorage({ pages: [[obj('o/1.png', 3)], [obj('o/2.png', 4)], [obj('o/3.png', 5)]] });
  const res = await runCopy(ctxFor(fake));
  assert.deepEqual({ ...res, failures: undefined }, { copied: 3, skipped: 0, failed: 0, bytes: 12, failures: undefined });
  const lists = fake.calls.filter((c) => c.query.get('list-type') === '2');
  assert.deepEqual(lists.map((c) => c.query.get('continuation-token')), [null, 't1', 't2']);
  assert.equal(lists[0].host, 'src-receipts.fly.storage.tigris.dev');
  assert.equal(fake.r2['o/2.png'].size, 4);
  assert.equal(fake.r2['o/2.png'].contentType, 'image/png');
});

test('--since skips older objects', async () => {
  const fake = fakeStorage({
    pages: [[obj('old.png', 1, '2025-12-31T23:59:59.000Z'), obj('new.png', 2, '2026-02-01T00:00:00.000Z')]],
  });
  const res = await runCopy(ctxFor(fake, { since: new Date('2026-01-01T00:00:00Z') }));
  assert.equal(res.copied, 1);
  assert.deepEqual(Object.keys(fake.r2), ['new.png']);
});

test('skips objects already in R2 with the same size and ETag', async () => {
  const fake = fakeStorage({
    pages: [[obj('same.png', 7), obj('diff.png', 7)]],
    r2: { 'same.png': { size: 7, etag: 'abc' }, 'diff.png': { size: 9, etag: 'abc' } },
  });
  const res = await runCopy(ctxFor(fake));
  assert.equal(res.skipped, 1);
  assert.equal(res.copied, 1);
  assert.equal(fake.calls.filter((c) => c.method === 'PUT').length, 1);
});

test('--dry-run sends no GET body and no PUT', async () => {
  const fake = fakeStorage({ pages: [[obj('a.png', 3), obj('b.png', 4)]] });
  const res = await runCopy(ctxFor(fake, { dryRun: true }));
  assert.equal(res.copied, 2);
  assert.equal(res.bytes, 7);
  assert.equal(fake.calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(fake.calls.filter((c) => c.method === 'GET' && !c.query.get('list-type')).length, 0);
});

test('a failing GET is retried, counted as failed, and the rest continue', async () => {
  const fake = fakeStorage({ pages: [[obj('ok1.png', 1), obj('bad.png', 2), obj('ok2.png', 3)]], failGet: new Set(['bad.png']) });
  const res = await runCopy(ctxFor(fake));
  assert.equal(res.failed, 1);
  assert.equal(res.copied, 2);
  assert.deepEqual(res.failures, [{ bucket: 'receipts', key: 'bad.png', error: 'GetObject failed: HTTP 500' }]);
  const badGets = fake.calls.filter((c) => c.method === 'GET' && c.path === '/bad.png');
  assert.equal(badGets.length, 4);
  assert.ok(!JSON.stringify(res.failures).includes('http'));
});
