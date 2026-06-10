/**
 * tests/unit/airtable-base-validation.test.ts
 *
 * Tests for assertAirtableBase() — warns when AIRTABLE_BASE_ID doesn't match
 * the expected base ID, and assertAirtableEnv() throws when AIRTABLE_BASE_ID
 * is missing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertAirtableBase, assertAirtableEnv, AirtableNotConfiguredError } from '@/lib/airtable/env';

const EXPECTED_BASE_ID = 'apphpwPe2olkGRSTkb';

function clearEnv() {
  delete process.env['AIRTABLE_PAT'];
  delete process.env['AIRTABLE_BASE_ID'];
}

function setBase(baseId?: string) {
  process.env['AIRTABLE_PAT'] = 'pat.test_token';
  if (baseId !== undefined) process.env['AIRTABLE_BASE_ID'] = baseId;
}

describe('assertAirtableBase()', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearEnv();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    clearEnv();
    warnSpy.mockRestore();
  });

  it('emits console.warn when AIRTABLE_BASE_ID is set to a wrong base ID', () => {
    setBase('appWRONGBASE');
    assertAirtableBase();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('appWRONGBASE');
  });

  it('does NOT emit console.warn when AIRTABLE_BASE_ID matches the expected base', () => {
    setBase(EXPECTED_BASE_ID);
    assertAirtableBase();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT throw when AIRTABLE_BASE_ID is undefined (assertAirtableBase is non-throwing)', () => {
    // Base ID is not set — assertAirtableBase should not throw; that is assertAirtableEnv's job
    delete process.env['AIRTABLE_BASE_ID'];
    expect(() => assertAirtableBase()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('assertAirtableEnv() throws when AIRTABLE_BASE_ID is missing', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('throws AirtableNotConfiguredError when AIRTABLE_BASE_ID is undefined', () => {
    process.env['AIRTABLE_PAT'] = 'pat.test_token';
    // AIRTABLE_BASE_ID intentionally not set
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
  });

  it('throws AirtableNotConfiguredError when AIRTABLE_PAT is undefined', () => {
    process.env['AIRTABLE_BASE_ID'] = EXPECTED_BASE_ID;
    // AIRTABLE_PAT intentionally not set
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
  });

  it('does not throw when both required vars are present', () => {
    setBase(EXPECTED_BASE_ID);
    expect(() => assertAirtableEnv()).not.toThrow();
  });
});
