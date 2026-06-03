/**
 * Grep test — AC11: internal_notes must never appear in PortalPreviewTab files.
 *
 * Reads the source of each portal-preview tab file and asserts that neither
 * "internal_notes" (snake_case DB column name) nor "internalNotes" (camelCase
 * variant) appears in the runtime code (comments excluded).
 *
 * This is a static analysis test — no rendering or runtime required.
 * Runs in < 10ms.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const TABS_DIR = join(
  REPO_ROOT,
  'src',
  'app',
  'dashboard',
  'tenants',
  '[id]',
  '_tabs'
);

const PORTAL_PREVIEW_FILES = [
  'PortalPreviewTab.tsx',
  'PortalHomeSection.tsx',
  'VisitorsSection.tsx',
  'NotificationsSection.tsx',
  'AnnouncementsSection.tsx',
  'AISessionsSection.tsx',
].map((f) => ({ name: f, path: join(TABS_DIR, f) }));

/** Strip single-line and multi-line JS/TS comments from source. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* block comments */
    .replace(/\/\/[^\n]*/g, '');        // // line comments
}

// ---------------------------------------------------------------------------
// AC11 — no "internal_notes" reference in portal-preview runtime code
// ---------------------------------------------------------------------------

describe('Portal Preview files — no internal_notes (AC11)', () => {
  for (const { name, path } of PORTAL_PREVIEW_FILES) {
    it(`${name}: no "internal_notes" string in runtime code (outside comments)`, () => {
      const source = readFileSync(path, 'utf8');
      const stripped = stripComments(source);
      expect(
        stripped,
        `Found "internal_notes" in ${name} — admin-only column must not appear in portal preview`
      ).not.toContain('internal_notes');
    });
  }
});

// ---------------------------------------------------------------------------
// AC11 — no "internalNotes" (camelCase variant) in portal-preview runtime code
// ---------------------------------------------------------------------------

describe('Portal Preview files — no internalNotes camelCase (AC11)', () => {
  for (const { name, path } of PORTAL_PREVIEW_FILES) {
    it(`${name}: no "internalNotes" (camelCase) in runtime code (outside comments)`, () => {
      const source = readFileSync(path, 'utf8');
      const stripped = stripComments(source);
      expect(
        stripped,
        `Found "internalNotes" in ${name} — admin-only notes must not appear in portal preview`
      ).not.toContain('internalNotes');
    });
  }
});
