/**
 * AC27 — i18n coverage test (npm run test:i18n)
 *
 * Validates:
 * 1. All keys in es.json (primary locale) exist in en.json and pt.json.
 * 2. All translation keys used in source files (via t() calls) resolve in es.json.
 * 3. AdminSidebar.tsx contains no hardcoded user-facing label strings (AC28).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import esMessages from '@/messages/es.json';
import enMessages from '@/messages/en.json';
import ptMessages from '@/messages/pt.json';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'src');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function walkDir(dir: string, exts = ['.ts', '.tsx', '.js', '.jsx']): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      results.push(...walkDir(full, exts));
    } else if (exts.includes(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

/** Extracts t('key') / t("key") string-literal keys from source. */
function extractTKeys(source: string): string[] {
  const keys: string[] = [];
  const pattern = /\bt\(\s*(['"`])([^'"`\s]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    keys.push(m[2]);
  }
  return keys;
}

/** Extracts useTranslations('ns') / getTranslations('ns') namespace names. */
function extractNamespaces(source: string): string[] {
  const ns: string[] = [];
  const patterns = [
    /useTranslations\(\s*(['"`])([^'"`]+)\1/g,
    /getTranslations\(\s*(['"`])([^'"`]+)\1/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(source)) !== null) {
      ns.push(m[2]);
    }
  }
  return ns;
}

// ---------------------------------------------------------------------------
// Locale completeness tests (es is primary)
// ---------------------------------------------------------------------------

describe('i18n — locale completeness (AC27)', () => {
  const esKeys = collectLeafKeys(esMessages as unknown as Record<string, unknown>);

  it('all es.json keys exist in en.json with a non-empty value', () => {
    const missing: string[] = [];
    for (const key of esKeys) {
      const esVal = getNestedValue(esMessages as unknown as Record<string, unknown>, key);
      if (esVal === '') continue; // intentionally empty (e.g. enterprise priceSuffix)
      const val = getNestedValue(enMessages as unknown as Record<string, unknown>, key);
      if (val === undefined || val === '') missing.push(key);
    }
    expect(missing, `Keys missing from en.json:\n  ${missing.join('\n  ')}`).toHaveLength(0);
  });

  it('all es.json keys exist in pt.json with a non-empty value', () => {
    const missing: string[] = [];
    for (const key of esKeys) {
      const esVal = getNestedValue(esMessages as unknown as Record<string, unknown>, key);
      if (esVal === '') continue;
      const val = getNestedValue(ptMessages as unknown as Record<string, unknown>, key);
      if (val === undefined || val === '') missing.push(key);
    }
    expect(missing, `Keys missing from pt.json:\n  ${missing.join('\n  ')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source-code usage check — every t('key') call resolves in primary locale
// ---------------------------------------------------------------------------

describe('i18n — source key resolution (AC27)', () => {
  it('all t() calls in src/ resolve to a defined key in es.json', () => {
    const sourceFiles = walkDir(SRC_DIR);
    const unresolved: Array<{ file: string; key: string }> = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      const namespaces = extractNamespaces(source);
      const keys = extractTKeys(source);

      if (keys.length === 0 || namespaces.length === 0) continue;

      for (const ns of namespaces) {
        const nsObj = getNestedValue(esMessages as unknown as Record<string, unknown>, ns);
        if (typeof nsObj !== 'object' || nsObj === null) continue; // unknown namespace

        for (const key of keys) {
          // Only check simple keys (no ICU message variables like {count})
          if (key.includes('{') || key.includes('(')) continue;
          const val = (nsObj as Record<string, unknown>)[key] ??
            getNestedValue(nsObj as Record<string, unknown>, key);
          if (val === undefined) {
            // Check as full dotPath within namespace
            const fullPath = `${ns}.${key}`;
            const fullVal = getNestedValue(esMessages as unknown as Record<string, unknown>, fullPath);
            if (fullVal === undefined) {
              unresolved.push({ file: file.replace(REPO_ROOT, ''), key: `${ns}.${key}` });
            }
          }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = unresolved.filter(({ key }) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    expect(
      unique,
      `Unresolved t() keys in es.json:\n${unique.map(u => `  [${u.key}] in ${u.file}`).join('\n')}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC28 — AdminSidebar must not contain hardcoded user-facing label strings
// ---------------------------------------------------------------------------

describe('AdminSidebar — no hardcoded user-facing strings (AC28)', () => {
  const sidebarPath = join(SRC_DIR, 'components', 'shell', 'AdminSidebar.tsx');

  it('AdminSidebar.tsx uses useTranslations', () => {
    const source = readFileSync(sidebarPath, 'utf8');
    expect(source).toContain("useTranslations('navigation')");
  });

  it('AdminSidebar.tsx nav items use labelKey (not label) for their label fields', () => {
    const source = readFileSync(sidebarPath, 'utf8');
    // The old pattern had `label: 'Dashboard'` etc. — after fix all labels use labelKey
    // Verify there is no raw `label:` string property in NavItem arrays
    // (label as a TS interface field is fine; label: 'SomeString' is the bad pattern)
    const hardcodedLabelPattern = /^\s+label:\s*['"][A-Z][a-zA-Z\s]+['"]/m;
    expect(
      hardcodedLabelPattern.test(source),
      'Found hardcoded label string in NavItem array — move to translation key'
    ).toBe(false);
  });

  it('AdminSidebar.tsx does not contain hardcoded Spanish or English nav label strings', () => {
    const source = readFileSync(sidebarPath, 'utf8');
    // These were the old hardcoded strings — they must not appear as JSX text or string literals
    const forbidden = [
      'Importación',   // was hardcoded Spanish in W10
      "'Dashboard'",
      "'Properties'",
      "'Units'",
      "'Tenants'",
      "'Finance'",
      "'Forecasting'",
      "'Pricing Tables'",
      "'Reminders'",
      "'Announcements'",
      "'Cleaning'",
      "'Leads'",
      "'WhatsApp'",
      "'Tasks'",
      "'Sanctions'",
      "'Community'",
      "'Visitors'",
      "'AI Assistant'",
      "'Executive Brief'",
      "'AI Analyst'",
    ];
    const found = forbidden.filter(s => source.includes(s));
    expect(
      found,
      `Found hardcoded strings in AdminSidebar.tsx: ${found.join(', ')}`
    ).toHaveLength(0);
  });
});
