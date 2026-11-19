#!/usr/bin/env node
// Usage: node scripts/check-worker-size.mjs <outdir>
// <outdir> is either an OpenNext output dir (.open-next: bundled through
// `wrangler deploy --dry-run` first) or a wrangler --outdir.
// Prints JSON { gzipBytes, limitBytes, paidLimitBytes, topModules[], topPackages[] }
// (module sizes come from the esbuild *.meta.json files OpenNext leaves in <outdir>).
// Exit 1 when gzipBytes exceeds the limit: the Workers Free limit (3 MiB) by
// default, or WORKER_SIZE_LIMIT_BYTES when set (e.g. the Paid limit in CI).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const FREE_LIMIT_BYTES = 3 * 1024 * 1024;
const PAID_LIMIT_BYTES = 10 * 1024 * 1024;
const TOP_N = 15;
const UPLOADED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.wasm', '.bin'];

function limitFromEnv() {
  const raw = process.env.WORKER_SIZE_LIMIT_BYTES?.trim();
  if (!raw) return FREE_LIMIT_BYTES;
  if (!/^[1-9]\d*$/.test(raw)) {
    console.error(`WORKER_SIZE_LIMIT_BYTES must be a positive integer, got "${raw}"`);
    process.exit(2);
  }
  return Number(raw);
}

function isOpenNextOutput(dir) {
  return existsSync(join(dir, 'worker.js')) && existsSync(join(dir, 'server-functions'));
}

function bundleWithWrangler(openNextDir) {
  const outdir = mkdtempSync(join(tmpdir(), 'propflow-worker-'));
  const wranglerBin = resolve('node_modules', 'wrangler', 'bin', 'wrangler.js');
  try {
    execFileSync(process.execPath, [wranglerBin, 'deploy', '--dry-run', '--outdir', outdir], {
      cwd: resolve(openNextDir, '..'),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch (error) {
    rmSync(outdir, { recursive: true, force: true });
    throw error;
  }
  return outdir;
}

function uploadedFiles(dir) {
  return readdirSync(dir)
    .filter((name) => UPLOADED_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .map((name) => join(dir, name));
}

function gzipSize(file) {
  return gzipSync(readFileSync(file)).length;
}

function findMetafiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findMetafiles(path);
    return entry.name.endsWith('.meta.json') ? [path] : [];
  });
}

function metafileSizes(dir) {
  const sizes = new Map();
  for (const file of findMetafiles(dir)) {
    const { outputs = {} } = JSON.parse(readFileSync(file, 'utf8'));
    for (const output of Object.values(outputs)) {
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs ?? {})) {
        sizes.set(input, (sizes.get(input) ?? 0) + bytesInOutput);
      }
    }
  }
  return sizes;
}

function packageOf(source) {
  const segments = source.split('node_modules/');
  if (segments.length < 2) return '(app)';
  const [first, second] = segments.at(-1).split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
}

function top(entries, key) {
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([path, bytes]) => ({ [key]: path, bytes }));
}

function topPackageSizes(sizes) {
  const byPackage = new Map();
  for (const [source, bytes] of sizes) {
    const pkg = packageOf(source);
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + bytes);
  }
  return top([...byPackage], 'package');
}

function main() {
  const [outdirArg] = process.argv.slice(2);
  if (!outdirArg) {
    console.error('usage: check-worker-size.mjs <outdir>');
    process.exit(2);
  }
  const limitBytes = limitFromEnv();
  const given = resolve(outdirArg);
  const dir = isOpenNextOutput(given) ? bundleWithWrangler(given) : given;
  try {
    const gzipBytes = uploadedFiles(dir).reduce((sum, file) => sum + gzipSize(file), 0);
    const sizes = metafileSizes(given);
    const report = {
      gzipBytes,
      limitBytes,
      paidLimitBytes: PAID_LIMIT_BYTES,
      withinFreeLimit: gzipBytes <= FREE_LIMIT_BYTES,
      withinPaidLimit: gzipBytes <= PAID_LIMIT_BYTES,
      topModules: top([...sizes], 'path'),
      topPackages: topPackageSizes(sizes),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = gzipBytes > limitBytes ? 1 : 0;
  } finally {
    if (dir !== given) rmSync(dir, { recursive: true, force: true });
  }
}

main();
