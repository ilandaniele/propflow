#!/usr/bin/env node
// W-CF-53 — Copy objects from Tigris (S3) to Cloudflare R2.
//
// Usage:
//   node scripts/migrate-to-r2/copy-objects.mjs [--since <ISO>] [--dry-run] [--bucket <logical>]
//
// Source (Tigris), same env names the pre-R2 storage module read:
//   endpoint: TIGRIS_ENDPOINT ?? AWS_ENDPOINT_URL_S3 ?? STORAGE_ENDPOINT
//   creds:    TIGRIS_ACCESS_KEY_ID / TIGRIS_SECRET_ACCESS_KEY
//             (fallback STORAGE_* then AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
//   buckets:  TIGRIS_BUCKET_<LOGICAL> ?? STORAGE_BUCKET ?? <logical>   (same order as old resolveBucket)
//   Virtual-hosted URLs (https://{bucket}.{endpoint-host}/{key}), like the old module.
// Destination (R2), same env names as src/lib/storage/index.ts:
//   R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default propflow-files)
//   Path-style URLs, object key = Tigris key (1:1). Logical buckets that share one
//   Tigris bucket (production: STORAGE_BUCKET) are copied once.
//
// Output: progress counts on stderr; final JSON { copied, skipped, failed, bytes } on stdout.
// Failed keys go to .migration/r2-failed.json. Exit 1 if failed > 0, 2 on bad config.
// No URL (signed or not) and no credential is ever printed.
//
// Bodies are buffered in memory, not streamed: files are <= ~25 MB and with
// concurrency 4 that is at most ~100 MB resident. Buffering also gives an exact
// Content-Length for the PUT and lets aws4fetch sign the payload hash.

import { AwsClient } from 'aws4fetch';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Logical bucket -> Tigris env var (copied from origin/main src/lib/storage/index.ts BUCKET_ENV_MAP) */
export const BUCKET_ENV_MAP = {
  'unit-images': 'TIGRIS_BUCKET_UNIT_IMAGES',
  'tenant-avatars': 'TIGRIS_BUCKET_TENANT_AVATARS',
  receipts: 'TIGRIS_BUCKET_RECEIPTS',
  'incident-photos': 'TIGRIS_BUCKET_INCIDENT_PHOTOS',
  'task-proofs': 'TIGRIS_BUCKET_TASK_PROOFS',
  contracts: 'TIGRIS_BUCKET_CONTRACTS',
};

export const LOGICAL_BUCKETS = Object.keys(BUCKET_ENV_MAP);

const DEFAULT_R2_BUCKET = 'propflow-files';
export const CONCURRENCY = 4;
const MAX_RETRIES = 3;
export const BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 60_000;
const FAILED_PATH = '.migration/r2-failed.json';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Physical Tigris bucket for a logical bucket — same precedence as the old resolveBucket() */
export function resolveSourceBucket(logicalBucket, env) {
  const envKey = BUCKET_ENV_MAP[logicalBucket];
  if (envKey && env[envKey]) return env[envKey];
  if (env.STORAGE_BUCKET) return env.STORAGE_BUCKET;
  return logicalBucket;
}

function xmlUnescape(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tag(xml, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlUnescape(m[1]) : undefined;
}

/** Strips quotes from an ETag header/XML value. */
export function normalizeEtag(etag) {
  if (!etag) return undefined;
  return etag.replace(/^W\//, '').replace(/^"|"$/g, '');
}

/**
 * Minimal ListObjectsV2 XML parser.
 * @returns {{ objects: {key:string,size:number,lastModified:string,etag?:string}[], isTruncated:boolean, nextToken?:string }}
 */
export function parseListXml(xml) {
  const objects = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const key = tag(block, 'Key');
    if (key === undefined) continue;
    objects.push({
      key,
      size: Number(tag(block, 'Size') ?? 0),
      lastModified: tag(block, 'LastModified') ?? '',
      etag: normalizeEtag(tag(block, 'ETag')),
    });
  }
  return {
    objects,
    isTruncated: tag(xml, 'IsTruncated') === 'true',
    nextToken: tag(xml, 'NextContinuationToken'),
  };
}

/** True if the object was modified at or after `since` (Date or undefined = no filter). */
export function isSince(obj, since) {
  if (!since) return true;
  const t = Date.parse(obj.lastModified);
  return Number.isNaN(t) ? true : t >= since.getTime();
}

/**
 * Decides whether a source object must be copied given the destination HEAD.
 * @param {{size:number, etag?:string}} src
 * @param {{size:number, etag?:string} | null} dest  null when the R2 object does not exist
 */
export function shouldCopy(src, dest) {
  if (!dest) return true;
  if (dest.size !== src.size) return true;
  // ETags are MD5 only for single-part uploads; multipart ETags ("<md5>-<n>") are not comparable.
  const comparable =
    src.etag && dest.etag && !src.etag.includes('-') && !dest.etag.includes('-');
  if (comparable && src.etag.toLowerCase() !== dest.etag.toLowerCase()) return true;
  return false;
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** Tigris virtual-hosted URL for an object, or the bucket root when key is undefined */
export function sourceUrl(endpoint, bucket, key) {
  const base = `${endpoint.protocol}//${bucket}.${endpoint.host}/`;
  return new URL(key === undefined ? base : base + encodeKey(key));
}

/** R2 path-style URL: {origin}/{bucket}/{key} — same key as Tigris, see src/lib/storage/index.ts objectKey() */
export function destUrl(endpoint, bucket, key) {
  return new URL(`${endpoint.origin}/${encodeURIComponent(bucket)}/${encodeKey(key)}`);
}

export function parseArgs(argv) {
  const opts = { since: undefined, dryRun: false, bucket: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--since') {
      const v = argv[++i];
      const d = new Date(v ?? '');
      if (!v || Number.isNaN(d.getTime())) throw new Error('--since needs an ISO date');
      opts.since = d;
    } else if (a === '--bucket') {
      const v = argv[++i];
      if (!v || !LOGICAL_BUCKETS.includes(v)) {
        throw new Error(`--bucket must be one of: ${LOGICAL_BUCKETS.join(', ')}`);
      }
      opts.bucket = v;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// HTTP with retries
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(op, status) {
    super(`${op} failed: HTTP ${status}`);
    this.status = status;
  }
}

/** Error text safe to log/persist: never the URL, never headers. */
export function safeMessage(err) {
  if (err instanceof HttpError) return err.message;
  const code = err?.cause?.code ?? err?.code ?? err?.name;
  return code ? `network error: ${code}` : 'network error';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Signs and sends one request. Retries MAX_RETRIES times on 5xx / network errors.
 * `accept` lists non-2xx statuses returned to the caller instead of thrown (e.g. 404 on HEAD).
 */
async function request(ctx, client, op, url, init = {}, accept = []) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(ctx.backoffMs * 2 ** (attempt - 1));
    try {
      const signed = await client.sign(url.toString(), { method: init.method ?? 'GET', headers: init.headers, body: init.body });
      const res = await ctx.fetch(signed.url, {
        method: init.method ?? 'GET',
        headers: signed.headers,
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok || accept.includes(res.status)) return res;
      await res.arrayBuffer().catch(() => {});
      lastErr = new HttpError(op, res.status);
      if (res.status < 500) throw lastErr; // 4xx: not retryable
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function* listObjects(ctx, physicalBucket) {
  let token;
  do {
    const url = sourceUrl(ctx.source.endpoint, physicalBucket);
    url.searchParams.set('list-type', '2');
    if (token) url.searchParams.set('continuation-token', token);
    const res = await request(ctx, ctx.source.client, 'ListObjectsV2', url);
    const page = parseListXml(await res.text());
    for (const o of page.objects) yield o;
    token = page.isTruncated ? page.nextToken : undefined;
  } while (token);
}

export async function headDest(ctx, key) {
  const res = await request(ctx, ctx.dest.client, 'HeadObject', destUrl(ctx.dest.endpoint, ctx.dest.bucket, key), { method: 'HEAD' }, [404]);
  if (res.status === 404) return null;
  return {
    size: Number(res.headers.get('content-length') ?? -1),
    etag: normalizeEtag(res.headers.get('etag') ?? undefined),
  };
}

async function copyOne(ctx, physical, obj) {
  const getRes = await request(ctx, ctx.source.client, 'GetObject', sourceUrl(ctx.source.endpoint, physical, obj.key));
  const body = new Uint8Array(await getRes.arrayBuffer());
  const contentType = getRes.headers.get('content-type') || 'application/octet-stream';
  await request(ctx, ctx.dest.client, 'PutObject', destUrl(ctx.dest.endpoint, ctx.dest.bucket, obj.key), {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(body.byteLength) },
    body,
  });
  return body.byteLength;
}

/** Runs `worker` over an async iterable with at most `limit` in flight. */
export async function pool(iterable, limit, worker) {
  const it = iterable[Symbol.asyncIterator]();
  let done = false;
  const next = async () => {
    for (;;) {
      if (done) return;
      const r = await it.next();
      if (r.done) { done = true; return; }
      await worker(r.value);
    }
  };
  await Promise.all(Array.from({ length: limit }, next));
}

/**
 * Copies every logical bucket from Tigris to R2.
 * @param {object} ctx { source:{client,endpoint}, dest:{client,endpoint,bucket}, buckets:[{logical,physical}],
 *                       since?:Date, dryRun?:boolean, fetch, concurrency?, backoffMs?, log? }
 * @returns {{ copied:number, skipped:number, failed:number, bytes:number, failures:{bucket,key,error}[] }}
 */
export async function runCopy(ctx) {
  ctx = { concurrency: CONCURRENCY, backoffMs: BACKOFF_MS, log: () => {}, ...ctx };
  const stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  const failures = [];
  let seen = 0;

  for (const { logical, physical } of ctx.buckets) {
    ctx.log(`[${logical}] listing`);
    const filtered = (async function* () {
      for await (const o of listObjects(ctx, physical)) {
        if (isSince(o, ctx.since)) yield o;
      }
    })();
    try {
      await pool(filtered, ctx.concurrency, async (obj) => {
        try {
          const dest = await headDest(ctx, obj.key);
          if (!shouldCopy(obj, dest)) {
            stats.skipped++;
          } else if (ctx.dryRun) {
            stats.copied++;
            stats.bytes += obj.size;
          } else {
            const copiedBytes = await copyOne(ctx, physical, obj);
            stats.bytes += copiedBytes;
            stats.copied++;
          }
        } catch (err) {
          stats.failed++;
          failures.push({ bucket: logical, key: obj.key, error: safeMessage(err) });
        }
        if (++seen % 50 === 0) ctx.log(`progress copied=${stats.copied} skipped=${stats.skipped} failed=${stats.failed}`);
      });
    } catch (err) {
      // Listing itself failed: the rest of this bucket is unknown. Record and move on.
      stats.failed++;
      failures.push({ bucket: logical, key: null, error: `list: ${safeMessage(err)}` });
    }
    ctx.log(`[${logical}] done copied=${stats.copied} skipped=${stats.skipped} failed=${stats.failed}`);
  }
  return { ...stats, failures };
}

// ---------------------------------------------------------------------------
// Config + main
// ---------------------------------------------------------------------------

/** Builds source/dest/buckets from env. Throws on missing config. */
export function buildConfig(env, opts) {
  const srcEndpoint = env.TIGRIS_ENDPOINT ?? env.AWS_ENDPOINT_URL_S3 ?? env.STORAGE_ENDPOINT;
  const srcKey = env.TIGRIS_ACCESS_KEY_ID ?? env.STORAGE_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
  const srcSecret = env.TIGRIS_SECRET_ACCESS_KEY ?? env.STORAGE_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
  const srcRegion = env.AWS_REGION ?? env.STORAGE_REGION ?? 'auto';
  if (!srcEndpoint || !srcKey || !srcSecret) {
    throw new Error('Missing source config: TIGRIS_ENDPOINT (or AWS_ENDPOINT_URL_S3), TIGRIS_ACCESS_KEY_ID, TIGRIS_SECRET_ACCESS_KEY');
  }
  const dstEndpoint = env.R2_S3_ENDPOINT;
  if (!dstEndpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing destination config: R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }

  const logicals = opts.bucket ? [opts.bucket] : LOGICAL_BUCKETS;
  const buckets = [];
  for (const logical of logicals) {
    const physical = resolveSourceBucket(logical, env);
    const shared = buckets.find((b) => b.physical === physical);
    if (shared) shared.logical += `+${logical}`;
    else buckets.push({ logical, physical });
  }

  return {
    source: {
      client: new AwsClient({ accessKeyId: srcKey, secretAccessKey: srcSecret, region: srcRegion, service: 's3', retries: 0 }),
      endpoint: new URL(srcEndpoint),
    },
    dest: {
      client: new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3', retries: 0 }),
      endpoint: new URL(dstEndpoint),
      bucket: env.R2_BUCKET || DEFAULT_R2_BUCKET,
    },
    buckets,
  };
}

async function main() {
  let opts, config;
  try {
    opts = parseArgs(process.argv.slice(2));
    config = buildConfig(process.env, opts);
  } catch (err) {
    process.stderr.write(`copy-objects: ${err.message}\n`);
    process.exit(2);
  }

  const log = (msg) => process.stderr.write(`${msg}\n`);
  if (opts.dryRun) log('dry-run: no PUT will be sent');
  const { failures, ...stats } = await runCopy({ ...config, since: opts.since, dryRun: opts.dryRun, fetch: globalThis.fetch, log });

  const failedPath = resolve(process.cwd(), FAILED_PATH);
  await mkdir(dirname(failedPath), { recursive: true });
  await writeFile(failedPath, JSON.stringify(failures, null, 2) + '\n');
  if (failures.length) log(`failed keys written to ${FAILED_PATH}`);

  process.stdout.write(JSON.stringify(stats) + '\n');
  process.exit(stats.failed > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`copy-objects: fatal: ${safeMessage(err)}\n`);
    process.exit(1);
  });
}
