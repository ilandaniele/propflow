#!/usr/bin/env node
// Local workerd PBKDF2-SHA256 benchmark (no deploy). Usage: node scripts/pbkdf2-bench/run.mjs
// Each run is one HTTP request that performs one deriveBits; the wall time is
// measured by the client (workerd freezes performance.now() during CPU work).
// The iterations=1 baseline (request overhead) is reported separately.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8788;
const RUNS = 20;
const ITERATIONS = [1, 10_000, 25_000, 50_000, 100_000];
const here = dirname(fileURLToPath(import.meta.url));
const wranglerBin = resolve(here, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`http://localhost:${PORT}/?iterations=1`);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
  throw new Error('wrangler dev did not start');
}

async function timeRuns(iterations) {
  const wallMs = [];
  const innerMs = [];
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    const body = await (await fetch(`http://localhost:${PORT}/?iterations=${iterations}`)).json();
    wallMs.push(performance.now() - started);
    innerMs.push(body.innerMs);
  }
  return { iterations, medianWallMs: median(wallMs), maxWallMs: Math.max(...wallMs), medianInnerMs: median(innerMs) };
}

const server = spawn(process.execPath, [wranglerBin, 'dev', '--config', join(here, 'wrangler.jsonc'), '--port', String(PORT)], {
  stdio: 'ignore',
});

try {
  await waitUntilReady();
  const results = [];
  for (const iterations of ITERATIONS) results.push(await timeRuns(iterations));
  console.log(JSON.stringify({ runsPerIteration: RUNS, results }, null, 2));
} finally {
  server.kill();
}
