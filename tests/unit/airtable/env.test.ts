/**
 * tests/unit/airtable/env.test.ts
 *
 * AC8: assertAirtableEnv() throws Errors.INTERNAL code AIRTABLE_NOT_CONFIGURED
 * when AIRTABLE_PAT or AIRTABLE_BASE_ID is missing. No HTTP request is issued.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertAirtableEnv, resolveTableEnvKey, AirtableNotConfiguredError } from '@/lib/airtable/env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ENV = {
  AIRTABLE_PAT: 'pat.test_token_abc123',
  AIRTABLE_BASE_ID: 'appABCDEF12345678',
  AIRTABLE_TABLE_ROOMS: 'tblROOMS123',
  AIRTABLE_TABLE_PERFORMANCE: 'tblPERF456',
  AIRTABLE_TABLE_KPIS: 'tblKPIS789',
};

function setEnv(overrides: Partial<typeof VALID_ENV> & Record<string, string | undefined> = {}) {
  const merged = { ...VALID_ENV, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearAirtableEnv() {
  for (const key of Object.keys(VALID_ENV)) {
    delete process.env[key];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertAirtableEnv', () => {
  beforeEach(() => clearAirtableEnv());
  afterEach(() => clearAirtableEnv());

  it('returns AirtableEnv when all required vars are present', () => {
    setEnv();
    const result = assertAirtableEnv();
    expect(result.pat).toBe(VALID_ENV.AIRTABLE_PAT);
    expect(result.baseId).toBe(VALID_ENV.AIRTABLE_BASE_ID);
    expect(result.tableRooms).toBe(VALID_ENV.AIRTABLE_TABLE_ROOMS);
  });

  it('throws AirtableNotConfiguredError when AIRTABLE_PAT is missing', () => {
    setEnv({ AIRTABLE_PAT: undefined });
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
    expect(() => assertAirtableEnv()).toThrow('AIRTABLE_PAT');
  });

  it('throws AirtableNotConfiguredError when AIRTABLE_BASE_ID is missing', () => {
    setEnv({ AIRTABLE_BASE_ID: undefined });
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
    expect(() => assertAirtableEnv()).toThrow('AIRTABLE_BASE_ID');
  });

  it('throws AirtableNotConfiguredError when both PAT and BASE_ID are missing', () => {
    // All env cleared already — throw for both
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
    expect(() => assertAirtableEnv()).toThrow('AIRTABLE_PAT');
  });

  it('error code is AIRTABLE_NOT_CONFIGURED', () => {
    clearAirtableEnv();
    try {
      assertAirtableEnv();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AirtableNotConfiguredError);
      expect((e as AirtableNotConfiguredError).code).toBe('AIRTABLE_NOT_CONFIGURED');
    }
  });

  it('does not include NEXT_PUBLIC_ prefix hint in error message', () => {
    // Confirm error message warns about NOT using NEXT_PUBLIC_
    setEnv({ AIRTABLE_PAT: undefined });
    try {
      assertAirtableEnv();
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('NEXT_PUBLIC_');
      expect((e as Error).message).toContain('NEVER');
    }
  });

  it('table env vars default to empty string when not set (PAT and BASE_ID present)', () => {
    setEnv({
      AIRTABLE_TABLE_ROOMS: undefined,
      AIRTABLE_TABLE_PERFORMANCE: undefined,
      AIRTABLE_TABLE_KPIS: undefined,
    });
    const result = assertAirtableEnv();
    expect(result.tableRooms).toBe('');
    expect(result.tablePerformance).toBe('');
    expect(result.tableKpis).toBe('');
  });

  it('AC8: no HTTP fetch is called when env is missing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    clearAirtableEnv();

    try {
      assertAirtableEnv();
    } catch {
      // expected
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('resolveTableEnvKey', () => {
  beforeEach(() => clearAirtableEnv());
  afterEach(() => clearAirtableEnv());

  it('returns the table id when the env var is set', () => {
    process.env['AIRTABLE_TABLE_ROOMS'] = 'tblROOMS123';
    expect(resolveTableEnvKey('AIRTABLE_TABLE_ROOMS')).toBe('tblROOMS123');
    delete process.env['AIRTABLE_TABLE_ROOMS'];
  });

  it('throws AirtableNotConfiguredError when the table env var is missing', () => {
    expect(() => resolveTableEnvKey('AIRTABLE_TABLE_ROOMS')).toThrow(AirtableNotConfiguredError);
    expect(() => resolveTableEnvKey('AIRTABLE_TABLE_ROOMS')).toThrow('AIRTABLE_TABLE_ROOMS');
  });
});
