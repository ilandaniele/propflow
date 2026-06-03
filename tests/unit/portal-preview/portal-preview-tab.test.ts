/**
 * Unit tests: PortalPreviewTab structure (AC6)
 *
 * Validates that the PortalPreviewTab source:
 *   AC6: contains exactly 5 independent <Suspense> boundaries
 *   AC5: contains no form, Server Action, or mutation button
 *   AC11: does not reference internal_notes (belt-and-suspenders alongside the
 *         grep test that W6 will add to no-internal-notes.test.ts)
 *
 * Strategy: read the source file and assert structural invariants. This is a
 * static analysis test — no runtime rendering required.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const TAB_FILE = join(
  REPO_ROOT,
  'src',
  'app',
  'dashboard',
  'tenants',
  '[id]',
  '_tabs',
  'PortalPreviewTab.tsx'
);

const SUB_COMPONENTS = [
  'PortalHomeSection.tsx',
  'VisitorsSection.tsx',
  'NotificationsSection.tsx',
  'AnnouncementsSection.tsx',
  'AISessionsSection.tsx',
].map((f) =>
  join(REPO_ROOT, 'src', 'app', 'dashboard', 'tenants', '[id]', '_tabs', f)
);

const ALL_FILES = [TAB_FILE, ...SUB_COMPONENTS];

// ---------------------------------------------------------------------------
// AC6 — 5 Suspense boundaries in PortalPreviewTab
// ---------------------------------------------------------------------------

describe('PortalPreviewTab — Suspense boundaries (AC6)', () => {
  it('contains exactly 5 <Suspense> opening tags', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    const matches = source.match(/<Suspense\b/g) ?? [];
    expect(
      matches.length,
      `Expected 5 <Suspense> boundaries, found ${matches.length}`
    ).toBe(5);
  });

  it('uses TabFallback as the fallback for every Suspense', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    const fallbackMatches = source.match(/fallback=\{<TabFallback\s*\/>\}/g) ?? [];
    expect(
      fallbackMatches.length,
      `Expected 5 TabFallback fallbacks, found ${fallbackMatches.length}`
    ).toBe(5);
  });

  it('imports TabFallback from the correct path', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    expect(source).toContain("from '@/components/ui/TabFallback'");
  });
});

// ---------------------------------------------------------------------------
// AC5 — strictly read-only (no mutations)
// ---------------------------------------------------------------------------

describe('PortalPreviewTab and sub-components — read-only enforcement (AC5)', () => {
  it('PortalPreviewTab.tsx contains no <form> element (JSX only, not comments)', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    // Strip single-line and multi-line comments before checking for JSX <form>
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/<form[\s>]/i);
  });

  it('PortalPreviewTab.tsx contains no Server Action exports', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    // Server Actions use 'use server' directive — must not appear in the tab file
    expect(source).not.toContain("'use server'");
    expect(source).not.toContain('"use server"');
  });

  it('no sub-component contains a <form> element', () => {
    for (const filePath of SUB_COMPONENTS) {
      const source = readFileSync(filePath, 'utf8');
      expect(
        source,
        `Found <form> in ${filePath} — portal preview must be read-only`
      ).not.toMatch(/<form[\s>]/i);
    }
  });

  it('no sub-component contains a Server Action export', () => {
    for (const filePath of SUB_COMPONENTS) {
      const source = readFileSync(filePath, 'utf8');
      expect(
        source,
        `Found 'use server' in ${filePath} — portal preview must be read-only`
      ).not.toContain("'use server'");
      expect(source).not.toContain('"use server"');
    }
  });
});

// ---------------------------------------------------------------------------
// AC11 — no internal_notes reference
// ---------------------------------------------------------------------------

describe('PortalPreviewTab and sub-components — no internal_notes (AC11)', () => {
  it('none of the portal preview files reference internal_notes outside of comments', () => {
    for (const filePath of ALL_FILES) {
      const source = readFileSync(filePath, 'utf8');
      // Strip comments before checking — the word may appear in JSDoc explaining
      // what is explicitly excluded; what matters is no runtime reference.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(
        stripped,
        `Found "internal_notes" in ${filePath} — must not appear in portal preview runtime code`
      ).not.toContain('internal_notes');
    }
  });
});

// ---------------------------------------------------------------------------
// Structure — all 5 section components are imported and rendered
// ---------------------------------------------------------------------------

describe('PortalPreviewTab — section imports (AC1)', () => {
  const source = readFileSync(TAB_FILE, 'utf8');

  it('imports PortalHomeSection', () => {
    expect(source).toContain("PortalHomeSection");
  });

  it('imports VisitorsSection', () => {
    expect(source).toContain("VisitorsSection");
  });

  it('imports NotificationsSection', () => {
    expect(source).toContain("NotificationsSection");
  });

  it('imports AnnouncementsSection', () => {
    expect(source).toContain("AnnouncementsSection");
  });

  it('imports AISessionsSection', () => {
    expect(source).toContain("AISessionsSection");
  });
});

// ---------------------------------------------------------------------------
// AC2 — yellow banner for null profile_id
// ---------------------------------------------------------------------------

describe('PortalPreviewTab — no-account banner (AC2)', () => {
  it('contains a conditional banner for missing portal account', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    // Banner is gated on !hasPortalAccount
    expect(source).toContain('hasPortalAccount');
    // Banner uses role="alert" for accessibility
    expect(source).toContain('role="alert"');
  });

  it('uses the i18n key for the banner message', () => {
    const source = readFileSync(TAB_FILE, 'utf8');
    expect(source).toContain("portalPreview.noLinkedAccount");
  });
});
