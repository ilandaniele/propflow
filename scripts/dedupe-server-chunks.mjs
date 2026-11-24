#!/usr/bin/env node
// Usage: node scripts/dedupe-server-chunks.mjs (after `next build`)
// Turbopack copies shared server modules (Drizzle schema, i18n messages, ...)
// into several merged chunks. The Worker ships every chunk, so each copy counts
// against the gzip size limit. This moves every module factory found in 2+
// chunks into one shared file and points the chunks at it.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const CHUNK_DIRS = ['.next/server/chunks', '.next/standalone/.next/server/chunks'];
const SHARED_NAME = '__shared-modules.js';
const MIDDLEWARE_TRACE = 'middleware.js.nft.json';
const CHUNK_PREFIX = 'module.exports=[';
const UNSAFE_SOURCE = /__dirname|__filename|import\.meta|require\(\s*["'`]\.{1,2}\//;
const JSON_MODULE = /^\((\w+),(\w+),(\w+)\)=>\{\2\.exports=(JSON\.parse\([\s\S]*\))\}$/;

const requireChunk = createRequire(import.meta.url);

function listChunks(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listChunks(path);
    if (!entry.name.endsWith('.js') || entry.name === SHARED_NAME) return [];
    return readFileSync(path, 'utf8').startsWith(CHUNK_PREFIX) ? [path] : [];
  });
}

// JSON modules (i18n messages) are identical across server layers except for
// the minified parameter names, so they are keyed by content alone.
function canonicalSource(source) {
  const json = JSON_MODULE.exec(source);
  return json ? `(a,b,c)=>{b.exports=${json[4]}}` : source;
}

function factoryKey(entries, index) {
  const source = entries[index].toString();
  return JSON_MODULE.test(source) ? canonicalSource(source) : `${entries[index - 1]}:${source}`;
}

function loadChunk(path) {
  const entries = requireChunk(path);
  if (!Array.isArray(entries)) throw new Error(`Unexpected chunk shape: ${path}`);
  return entries;
}

function countFactories(chunks) {
  const counts = new Map();
  for (const { entries } of chunks) {
    entries.forEach((entry, index) => {
      if (typeof entry !== 'function' || UNSAFE_SOURCE.test(entry.toString())) return;
      const key = factoryKey(entries, index);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return counts;
}

function sharedRequire(chunksDir, chunkPath) {
  const path = relative(dirname(chunkPath), join(chunksDir, SHARED_NAME)).split(sep).join('/');
  return `require(${JSON.stringify(path.startsWith('.') ? path : `./${path}`)})`;
}

function listTraces(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTraces(path);
    return entry.name.endsWith('.nft.json') ? [path] : [];
  });
}

// OpenNext copies only traced files, so every trace that lists a rewritten
// chunk must also list the shared file.
function traceSharedFile(serverDir, sharedPath, rewritten) {
  const hash = createHash('md5').update(readFileSync(sharedPath)).digest('hex');
  for (const tracePath of listTraces(serverDir)) {
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
    const sharedFile = relative(dirname(tracePath), sharedPath).split(sep).join('/');
    const needsShared = trace.files.some((file) => rewritten.has(resolve(dirname(tracePath), file)));
    if (!needsShared || trace.files.includes(sharedFile)) continue;
    trace.files.push(sharedFile);
    if (Array.isArray(trace.fileHashes)) trace.fileHashes.push(hash);
    writeFileSync(tracePath, JSON.stringify(trace));
  }
}

// The middleware is bundled on its own; pointing its chunks at the shared file
// would add every shared module to that bundle.
function middlewareChunks(serverDir) {
  const tracePath = join(serverDir, MIDDLEWARE_TRACE);
  if (!existsSync(tracePath)) return new Set();
  const { files } = JSON.parse(readFileSync(tracePath, 'utf8'));
  return new Set(files.map((file) => resolve(serverDir, file)));
}

function dedupe(chunksDir) {
  const skipped = middlewareChunks(dirname(chunksDir));
  const chunks = listChunks(chunksDir)
    .filter((path) => !skipped.has(path))
    .map((path) => ({ path, entries: loadChunk(path) }));
  const counts = countFactories(chunks);
  const sharedIds = new Map();
  const rewritten = new Set();

  for (const { path, entries } of chunks) {
    let changed = false;
    const parts = entries.map((entry, index) => {
      if (typeof entry !== 'function') return String(entry);
      const source = entry.toString();
      const key = factoryKey(entries, index);
      if ((counts.get(key) ?? 0) < 2) return source;
      if (!sharedIds.has(key)) sharedIds.set(key, { id: sharedIds.size, source: canonicalSource(source) });
      changed = true;
      return `${sharedRequire(chunksDir, path)}[${sharedIds.get(key).id}]`;
    });
    if (!changed) continue;
    writeFileSync(path, `${CHUNK_PREFIX}${parts.join(',')}];\n`);
    rewritten.add(path);
  }

  const shared = [...sharedIds.values()].map(({ source }) => source).join(',\n');
  const sharedPath = join(chunksDir, SHARED_NAME);
  writeFileSync(sharedPath, `module.exports=[\n${shared}\n];\n`);
  traceSharedFile(dirname(chunksDir), sharedPath, rewritten);
  console.log(`dedupe-server-chunks: ${chunksDir}: ${sharedIds.size} shared module factories`);
}

for (const dir of CHUNK_DIRS.map((path) => resolve(path)).filter(existsSync)) dedupe(dir);
