#!/usr/bin/env node
// W-CF-53 — Checks that R2 holds every Tigris object and every file the DB points at (docs/07 §7.6).
//
// Usage:
//   node scripts/migrate-to-r2/verify-objects.mjs [--in .migration/export] [--bucket <logical>]
//
// Same env as copy-objects.mjs (Tigris source, R2 destination). Read only: LIST on
// Tigris, HEAD on R2. Per Tigris bucket: object count and bytes, and how many of
// them are missing in R2 or have another size there. Then every stored file
// reference in the export directory (a value that is not an http(s) URL, see
// src/lib/storage/resolve.ts) must exist in R2. A reference that is missing in
// Tigris too was already broken before the copy: it is counted, not failed.
// Prints counts only. Failing keys go to .migration/r2-verify-failed.json.
// Exit 0 only when nothing is missing.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readExport } from '../migrate-to-d1/transform.mjs';
import { BACKOFF_MS, CONCURRENCY, buildConfig, headDest, listObjects, pool, safeMessage } from './copy-objects.mjs';

const FAILED_PATH = '.migration/r2-verify-failed.json';

/** Columns that hold a storage path (or a legacy absolute URL), by table. */
export const STORED_FILE_COLUMNS = {
  account_statements: ['pdf_url'],
  agent_calls: ['recording_url'],
  contracts: ['document_url'],
  expenses: ['receipt_path'],
  incidents: ['photo_path'],
  listing_images: ['storage_path'],
  payment_receipts: ['image_path'],
  payments: ['receipt_url'],
  receipt_uploads: ['file_path'],
  responsables: ['photo_url'],
  signature_requests: ['signature_image_path'],
  task_proofs: ['image_path'],
  tax_receipts: ['file_url'],
  tenants: ['photo_url'],
  trash_compliance: ['foto_url'],
  unit_images: ['storage_path'],
  whatsapp_messages: ['attachment_path'],
};

export const isStoredKey = (value) => typeof value === 'string' && value !== '' && !/^https?:\/\//i.test(value);

/** Every distinct object key the exported rows point at. */
export async function referencedKeys(inDir, columns = STORED_FILE_COLUMNS) {
  const keys = new Set();
  for (const [table, names] of Object.entries(columns)) {
    const data = await readExport(inDir, table);
    for (const row of data?.rows ?? []) {
      for (const name of names) if (isStoredKey(row[name])) keys.add(row[name]);
    }
  }
  return keys;
}

async function* each(items) {
  yield* items;
}

/**
 * HEADs in R2 every object of each Tigris bucket, then every referenced key.
 * @param {object} ctx copy-objects config plus { fetch, references:Set<string>, concurrency?, backoffMs? }
 */
export async function verifyObjects(ctx) {
  ctx = { concurrency: CONCURRENCY, backoffMs: BACKOFF_MS, ...ctx };
  const report = { buckets: [], references: { total: ctx.references.size, missing: 0, missingAtSource: 0 }, failures: [] };
  const sourceKeys = new Set();
  const fail = (bucket, key, reason) => report.failures.push({ bucket, key, reason });

  for (const { logical, physical } of ctx.buckets) {
    const stats = { logical, objects: 0, bytes: 0, r2Objects: 0, r2Bytes: 0, missing: 0, sizeDiffers: 0, errors: 0 };
    report.buckets.push(stats);
    try {
      await pool(listObjects(ctx, physical), ctx.concurrency, async (obj) => {
        sourceKeys.add(obj.key);
        stats.objects++;
        stats.bytes += obj.size;
        try {
          const dest = await headDest(ctx, obj.key);
          if (!dest) {
            stats.missing++;
            fail(logical, obj.key, 'missing');
            return;
          }
          stats.r2Objects++;
          stats.r2Bytes += dest.size;
          if (dest.size !== obj.size) {
            stats.sizeDiffers++;
            fail(logical, obj.key, 'size');
          }
        } catch (err) {
          stats.errors++;
          fail(logical, obj.key, safeMessage(err));
        }
      });
    } catch (err) {
      stats.errors++;
      fail(logical, null, `list: ${safeMessage(err)}`);
    }
  }

  const unchecked = [...ctx.references].filter((key) => !sourceKeys.has(key));
  await pool(each(unchecked), ctx.concurrency, async (key) => {
    try {
      if (await headDest(ctx, key)) return;
      report.references.missingAtSource++;
    } catch (err) {
      report.references.missing++;
      fail('references', key, safeMessage(err));
    }
  });
  const missingInR2 = new Set(report.failures.filter((f) => f.reason === 'missing').map((f) => f.key));
  report.references.missing += [...ctx.references].filter((key) => missingInR2.has(key)).length;

  report.ok =
    report.buckets.every((b) => b.missing === 0 && b.sizeDiffers === 0 && b.errors === 0) && report.references.missing === 0;
  return report;
}

export function formatReport(report) {
  const lines = report.buckets.map(
    (b) =>
      `${b.missing || b.sizeDiffers || b.errors ? 'FAIL' : 'OK  '} ${b.logical}: tigris=${b.objects} (${b.bytes} B) ` +
      `r2=${b.r2Objects} (${b.r2Bytes} B) missing=${b.missing} size_differs=${b.sizeDiffers} errors=${b.errors}`,
  );
  const r = report.references;
  lines.push(
    `${r.missing ? 'FAIL' : 'OK  '} referenced files: ${r.total} missing_in_r2=${r.missing} already_missing_in_tigris=${r.missingAtSource}`,
    report.ok ? 'verify-objects: OK' : 'verify-objects: FAILED',
  );
  return lines.join('\n');
}

export function parseArgs(argv) {
  const opts = { inDir: '.migration/export', bucket: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') opts.inDir = argv[++i];
    else if (argv[i] === '--bucket') opts.bucket = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { ...opts, inDir: resolve(opts.inDir) };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = buildConfig(process.env, { bucket: opts.bucket });
  const references = await referencedKeys(opts.inDir);
  const report = await verifyObjects({ ...config, references, fetch: globalThis.fetch });

  const failedPath = resolve(process.cwd(), FAILED_PATH);
  await mkdir(dirname(failedPath), { recursive: true });
  await writeFile(failedPath, `${JSON.stringify(report.failures, null, 2)}\n`);
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`verify-objects: ${err instanceof Error && !err.status ? err.message : safeMessage(err)}`);
    process.exit(1);
  });
}
