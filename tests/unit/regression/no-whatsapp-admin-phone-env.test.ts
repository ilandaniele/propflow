/**
 * Regression guard (T12): ensures WHATSAPP_ADMIN_PHONE is never re-introduced
 * in source code, tests, or environment files after Phase 5 removal.
 *
 * This test scans the file tree using Node fs APIs and fails if the token
 * "WHATSAPP_ADMIN_PHONE" appears anywhere outside this guard test itself.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const BANNED_TOKEN = 'WHATSAPP_ADMIN_PHONE';

const ROOT = path.resolve(__dirname, '../../..'); // propflow root

/** Recursively collect all files under dir, excluding node_modules and .git. */
function collectFiles(dir: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

describe('regression: WHATSAPP_ADMIN_PHONE must not exist in the codebase', () => {
  it('finds zero references to WHATSAPP_ADMIN_PHONE outside this guard file', () => {
    const files = collectFiles(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      // Allow the guard test file itself and binary/lock files
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rel.includes('no-whatsapp-admin-phone-env')) continue;  // this file
      if (
        file.endsWith('.png') ||
        file.endsWith('.jpg') ||
        file.endsWith('.ico') ||
        file.endsWith('.woff') ||
        file.endsWith('.woff2') ||
        file.endsWith('-lock.yaml') ||
        file.endsWith('package-lock.json')
      ) continue;

      let content: string;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue; // binary or unreadable file
      }

      if (content.includes(BANNED_TOKEN)) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      // Provide a clear error message listing exactly which files contain the banned token
      const list = violations.map(f => `  - ${f}`).join('\n');
      throw new Error(
        `WHATSAPP_ADMIN_PHONE was found in ${violations.length} file(s).\n` +
        `This env var was removed in Phase 5 — recipients are now resolved from DB.\n` +
        `Files with violations:\n${list}`
      );
    }

    expect(violations).toHaveLength(0);
  });
});
