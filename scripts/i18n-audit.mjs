#!/usr/bin/env node
/**
 * i18n-audit.mjs — scans src/ for t('...') and useTranslations('...') calls,
 * extracts all used translation keys, and checks each key exists in all locale files.
 *
 * Exit code: 0 if no keys missing, 1 if any key is missing.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const MESSAGES_DIR = join(ROOT, 'src', 'messages');

const LOCALES = ['es', 'en', 'pt'];

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function walkDir(dir, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // skip node_modules, .next, dist
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      results.push(...walkDir(full, extensions));
    } else if (extensions.includes(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Key extraction patterns
// ---------------------------------------------------------------------------

/**
 * Extracts keys from:
 *   t('some.key')             — direct t() call with string literal
 *   t("some.key")             — double-quote variant
 *   t(`some.key`)             — static template literal only (no ${} interpolation)
 *
 * Skips dynamic keys that use template literal interpolation (e.g. t(`features.${key}`))
 * as these cannot be statically resolved.
 *
 * Also captures useTranslations('namespace') to map component-level namespaces.
 * The audit uses (namespace, key) pairs when the namespace is determinable,
 * or falls back to recording raw keys.
 */
function extractTranslationKeys(source) {
  const keys = [];

  // Match t('key') and t("key") — single/double quote variants only (always static)
  const tCallPattern = /\bt\(\s*(['"])([^'"$\s]+)\1/g;
  let m;
  while ((m = tCallPattern.exec(source)) !== null) {
    keys.push(m[2]);
  }

  // Match t(`key`) — backtick variant — only when no ${} interpolation present
  const tBacktickPattern = /\bt\(\s*`([^`$]+)`/g;
  while ((m = tBacktickPattern.exec(source)) !== null) {
    keys.push(m[1]);
  }

  return keys;
}

/**
 * Extracts useTranslations('namespace') calls so we can pair namespaces with keys.
 * Returns an array of namespace strings found in the file.
 */
function extractNamespaces(source) {
  const namespaces = [];
  const pattern = /useTranslations\(\s*(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    namespaces.push(m[2]);
  }
  // Also getTranslations (server components)
  const pattern2 = /getTranslations\(\s*(['"`])([^'"`]+)\1/g;
  while ((m = pattern2.exec(source)) !== null) {
    namespaces.push(m[2]);
  }
  return namespaces;
}

// ---------------------------------------------------------------------------
// Locale JSON helpers
// ---------------------------------------------------------------------------

function loadLocale(locale) {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectLeafKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function getNestedValue(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Main audit logic
// ---------------------------------------------------------------------------

function main() {
  // Load all locale files
  const locales = {};
  for (const locale of LOCALES) {
    locales[locale] = loadLocale(locale);
  }

  // Collect all leaf keys from primary locale (es)
  const primaryKeys = new Set(collectLeafKeys(locales['es']));

  // Scan src/ for t() calls to identify used keys
  const sourceFiles = walkDir(SRC_DIR);
  const usedKeysByNamespace = new Map(); // namespace -> Set<localKey>
  const rawKeys = new Set(); // keys without namespace context

  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8');
    const namespaces = extractNamespaces(source);
    const keys = extractTranslationKeys(source);

    if (keys.length === 0) continue;

    if (namespaces.length > 0) {
      // Pair keys with namespace(s) found in this file
      for (const ns of namespaces) {
        if (!usedKeysByNamespace.has(ns)) {
          usedKeysByNamespace.set(ns, new Set());
        }
        for (const key of keys) {
          usedKeysByNamespace.get(ns).add(key);
        }
      }
    } else {
      for (const key of keys) {
        rawKeys.add(key);
      }
    }
  }

  // Build fully-qualified keys from namespace+key pairs
  const usedFullKeys = new Set();
  for (const [ns, keys] of usedKeysByNamespace) {
    for (const key of keys) {
      usedFullKeys.add(`${ns}.${key}`);
    }
  }
  for (const key of rawKeys) {
    usedFullKeys.add(key);
  }

  // Check: every key in es.json must exist in en.json and pt.json
  const missingByLocale = {};
  for (const locale of LOCALES) {
    if (locale === 'es') continue; // es is the primary source
    missingByLocale[locale] = [];
    for (const key of primaryKeys) {
      const esVal = getNestedValue(locales['es'], key);
      if (esVal === '' || esVal === undefined) continue; // intentionally empty
      const val = getNestedValue(locales[locale], key);
      if (val === undefined || val === '') {
        missingByLocale[locale].push(key);
      }
    }
  }

  // Check: every used key (that matches a known namespace) must exist in es.json
  const missingInPrimary = [];
  for (const fullKey of usedFullKeys) {
    const val = getNestedValue(locales['es'], fullKey);
    if (val === undefined) {
      // Only report if the key's top-level namespace exists in es.json
      const topNs = fullKey.split('.')[0];
      if (locales['es'][topNs] !== undefined) {
        missingInPrimary.push(fullKey);
      }
    }
  }

  // Report results
  let hasErrors = false;

  if (missingInPrimary.length > 0) {
    console.error(`\n[i18n-audit] MISSING in es.json (used in source but not defined):`);
    for (const key of missingInPrimary) {
      console.error(`  - ${key}`);
    }
    hasErrors = true;
  }

  for (const locale of Object.keys(missingByLocale)) {
    const missing = missingByLocale[locale];
    if (missing.length > 0) {
      console.error(`\n[i18n-audit] MISSING in ${locale}.json (keys present in es.json but absent):`);
      for (const key of missing) {
        console.error(`  - ${key}`);
      }
      hasErrors = true;
    }
  }

  // Summary
  const totalPrimary = primaryKeys.size;
  const totalUsed = usedFullKeys.size;

  if (hasErrors) {
    console.error(`\n[i18n-audit] FAILED — fix missing keys above.`);
    process.exit(1);
  } else {
    console.log(`[i18n-audit] OK — ${totalPrimary} keys in es.json, ${totalUsed} key references scanned from source.`);
    console.log(`[i18n-audit] All locale files (es, en, pt) are consistent.`);
    process.exit(0);
  }
}

main();
