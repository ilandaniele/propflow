#!/usr/bin/env node
/**
 * scripts/check-typosquat.mjs
 *
 * Heuristic typosquat detector for new npm dependencies.
 *
 * Checks package.json deps against a known list of confusable names and
 * also flags packages with suspiciously low weekly downloads (< 1 000).
 *
 * Exits 0 if no issues found, 1 if any confusable name detected.
 *
 * T57 (CI): called as a CI step after npm ci.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Known confusable package names (typosquat known-bad → intended-good)
// Source: npm security advisories, snyk research
// ---------------------------------------------------------------------------
const CONFUSABLE_PAIRS = new Map([
  // Classic typosquats
  ['crossenv',           'cross-env'],
  ['babel-cli',          '@babel/cli'],
  ['lodahs',             'lodash'],
  ['loadsh',             'loadash'],
  ['reeact',             'react'],
  ['recat',              'react'],
  ['babelcli',           '@babel/cli'],
  ['eslint-config-airbn', 'eslint-config-airbnb'],
  ['discord.js',         'discord.js (check exact casing)'],
  ['event-source-ponyfill', 'eventsource'], // known malicious clone
  ['tslint-config-airbnb', 'tslint-config-airbnb (deprecated, use ESLint)'],
  ['coloers',            'colors'],
  ['colour',             'color'],
  ['momentjs',           'moment'],
  ['axios-https-proxy-fix', 'axios (apply fix inline)'],
  ['nopd',               'node-pre-gyp'],
  ['jest-cli2',          'jest'],
  ['react-native-navigationbar', 'react-native-navigation-bar'],
  ['nodemailer-html-to-text', 'html-to-text'],
  ['typosquat-example',  'this-package-does-not-exist (test)'],
  // Next.js / auth / ORM ecosystem typosquats
  ['next-auth2',         'next-auth'],
  ['drizzle-ohm',        'drizzle-orm'],
  ['postgres-js',        'postgres'],
  ['anthropic-ai',       '@anthropic-ai/sdk'],
  ['anthropics',         '@anthropic-ai/sdk'],
  ['zod2',               'zod'],
]);

// ---------------------------------------------------------------------------
// Packages to skip the low-download check (legitimate low-volume packages)
// ---------------------------------------------------------------------------
const LOW_DOWNLOAD_SKIP = new Set([
  // Internal / workspace packages typically have 0 downloads on npm
]);

// ---------------------------------------------------------------------------
// Read package.json
// ---------------------------------------------------------------------------

const pkgPath = join(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  console.error('[typosquat] package.json not found at', pkgPath);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const allDeps = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
};

const depNames = Object.keys(allDeps);
let foundIssues = false;

// ---------------------------------------------------------------------------
// Check 1: Known confusable names
// ---------------------------------------------------------------------------

console.log('[typosquat] Checking', depNames.length, 'packages against confusable name list...');

for (const dep of depNames) {
  const intended = CONFUSABLE_PAIRS.get(dep);
  if (intended) {
    console.error(
      `[typosquat] ALERT: "${dep}" matches known confusable package!\n` +
      `  Possible typosquat of: "${intended}"\n` +
      `  Remove "${dep}" from package.json and verify intent.`,
    );
    foundIssues = true;
  }
}

// ---------------------------------------------------------------------------
// Check 2: Very similar names to core dependencies (Levenshtein distance = 1)
// ---------------------------------------------------------------------------

const CORE_PACKAGES = [
  'next', 'react', 'react-dom', 'zod', 'next-auth',
  'drizzle-orm', 'postgres', '@aws-sdk/client-s3',
  '@anthropic-ai/sdk', 'next-intl', 'papaparse',
  'react-markdown', 'rehype-sanitize', 'resend',
];

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

for (const dep of depNames) {
  for (const core of CORE_PACKAGES) {
    if (dep === core) continue; // exact match = fine
    // Strip scope prefix for comparison (e.g. @supabase/supabase-js → supabase-js)
    const depBase = dep.replace(/^@[^/]+\//, '');
    const coreBase = core.replace(/^@[^/]+\//, '');
    if (depBase.length < 3 || coreBase.length < 3) continue; // too short to compare
    const dist = levenshtein(depBase.toLowerCase(), coreBase.toLowerCase());
    if (dist === 1) {
      console.warn(
        `[typosquat] WARNING: "${dep}" has edit-distance 1 from core package "${core}".\n` +
        `  This may be a typosquat. Verify this package is intentional.`,
      );
      // Note: warn only (not error) — may be legitimate (e.g. react-markdown vs react-mark)
    }
  }
}

// ---------------------------------------------------------------------------
// Check 3: Low weekly download count (optional, requires network)
// ---------------------------------------------------------------------------

// Only run the download check in CI when the network is available.
// Skip in local dev to avoid slowing down the developer workflow.
const RUN_DOWNLOAD_CHECK = process.env.CI === 'true';
const DOWNLOAD_THRESHOLD = 1_000;

if (RUN_DOWNLOAD_CHECK) {
  console.log('[typosquat] Checking weekly download counts (CI mode)...');

  for (const dep of depNames) {
    if (LOW_DOWNLOAD_SKIP.has(dep)) continue;
    if (dep.startsWith('@') && dep.includes('/')) {
      // Scoped packages: npm view is reliable; proceed.
    }
    try {
      const stdout = execSync(`npm view "${dep}" downloads-last-week 2>/dev/null || echo 0`, {
        encoding: 'utf8',
        timeout: 10_000,
      }).trim();
      const count = parseInt(stdout, 10) || 0;
      if (count > 0 && count < DOWNLOAD_THRESHOLD) {
        console.warn(
          `[typosquat] WARNING: "${dep}" has only ${count} weekly downloads.\n` +
          `  Low-traffic packages carry higher supply-chain risk. Verify provenance.`,
        );
      }
    } catch {
      // Ignore errors (package may be private or network unavailable)
    }
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (foundIssues) {
  console.error('\n[typosquat] FAILED — confusable package names detected (see above).');
  process.exit(1);
}

console.log('[typosquat] OK — no confusable package names detected.');
process.exit(0);
