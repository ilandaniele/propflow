/**
 * tests/unit/airtable-env.test.ts
 *
 * W1 — AC7: verifies that the four new entity table env vars are recognised by
 * assertAirtableEnv() and resolveEntityTableEnvKey(), and that missing vars
 * cause a clean skip (null) rather than an error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertAirtableEnv,
  resolveEntityTableEnvKey,
  AirtableNotConfiguredError,
} from '@/lib/airtable/env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ENV = {
  AIRTABLE_PAT: 'pat.unit_test_token',
  AIRTABLE_BASE_ID: 'appUNITTEST12345',
};

function setBase() {
  for (const [k, v] of Object.entries(BASE_ENV)) {
    process.env[k] = v;
  }
}

function clearAll() {
  delete process.env['AIRTABLE_PAT'];
  delete process.env['AIRTABLE_BASE_ID'];
  delete process.env['AIRTABLE_TABLE_RESIDENTES'];
  delete process.env['AIRTABLE_TABLE_PROPIEDADES'];
  delete process.env['AIRTABLE_TABLE_PAGOS'];
  delete process.env['AIRTABLE_TABLE_HISTORIAL'];
}

// ---------------------------------------------------------------------------
// assertAirtableEnv — entity table vars
// ---------------------------------------------------------------------------

describe('assertAirtableEnv — entity table env vars (AC7)', () => {
  beforeEach(() => { clearAll(); setBase(); });
  afterEach(clearAll);

  it('returns tableResidentes = null when AIRTABLE_TABLE_RESIDENTES is not set', () => {
    const env = assertAirtableEnv();
    expect(env.tableResidentes).toBeNull();
  });

  it('returns tablePropiedades = null when AIRTABLE_TABLE_PROPIEDADES is not set', () => {
    const env = assertAirtableEnv();
    expect(env.tablePropiedades).toBeNull();
  });

  it('returns tablePagos = null when AIRTABLE_TABLE_PAGOS is not set', () => {
    const env = assertAirtableEnv();
    expect(env.tablePagos).toBeNull();
  });

  it('returns tableHistorial = null when AIRTABLE_TABLE_HISTORIAL is not set', () => {
    const env = assertAirtableEnv();
    expect(env.tableHistorial).toBeNull();
  });

  it('returns the table name string when AIRTABLE_TABLE_RESIDENTES is set', () => {
    process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRESIDENTES001';
    const env = assertAirtableEnv();
    expect(env.tableResidentes).toBe('tblRESIDENTES001');
  });

  it('returns the table name string when AIRTABLE_TABLE_PROPIEDADES is set', () => {
    process.env['AIRTABLE_TABLE_PROPIEDADES'] = 'tblPROPIEDADES001';
    const env = assertAirtableEnv();
    expect(env.tablePropiedades).toBe('tblPROPIEDADES001');
  });

  it('returns the table name string when AIRTABLE_TABLE_PAGOS is set', () => {
    process.env['AIRTABLE_TABLE_PAGOS'] = 'tblPAGOS001';
    const env = assertAirtableEnv();
    expect(env.tablePagos).toBe('tblPAGOS001');
  });

  it('returns the table name string when AIRTABLE_TABLE_HISTORIAL is set', () => {
    process.env['AIRTABLE_TABLE_HISTORIAL'] = 'tblHISTORIAL001';
    const env = assertAirtableEnv();
    expect(env.tableHistorial).toBe('tblHISTORIAL001');
  });

  it('does NOT throw when all four entity vars are missing (AC7: clean skip)', () => {
    // None of the entity vars are set — assertAirtableEnv must still succeed
    expect(() => assertAirtableEnv()).not.toThrow();
  });

  it('does NOT throw when only some entity vars are set', () => {
    process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRES';
    // Other three are unset
    const env = assertAirtableEnv();
    expect(env.tableResidentes).toBe('tblRES');
    expect(env.tablePropiedades).toBeNull();
    expect(env.tablePagos).toBeNull();
    expect(env.tableHistorial).toBeNull();
  });

  it('still throws AirtableNotConfiguredError when PAT is missing even if entity vars are set', () => {
    delete process.env['AIRTABLE_PAT'];
    process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRES';
    expect(() => assertAirtableEnv()).toThrow(AirtableNotConfiguredError);
  });
});

// ---------------------------------------------------------------------------
// resolveEntityTableEnvKey
// ---------------------------------------------------------------------------

describe('resolveEntityTableEnvKey (AC7)', () => {
  afterEach(clearAll);

  it('returns the table name when the entity env var is set', () => {
    process.env['AIRTABLE_TABLE_RESIDENTES'] = 'tblRESIDENTES';
    expect(resolveEntityTableEnvKey('AIRTABLE_TABLE_RESIDENTES')).toBe('tblRESIDENTES');
    delete process.env['AIRTABLE_TABLE_RESIDENTES'];
  });

  it('returns null when the env var is absent', () => {
    expect(resolveEntityTableEnvKey('AIRTABLE_TABLE_PAGOS')).toBeNull();
  });

  it('returns null for an unknown env key (no throw)', () => {
    expect(resolveEntityTableEnvKey('AIRTABLE_TABLE_NONEXISTENT')).toBeNull();
  });

  it('returns null when the env var is set to an empty string', () => {
    process.env['AIRTABLE_TABLE_HISTORIAL'] = '';
    expect(resolveEntityTableEnvKey('AIRTABLE_TABLE_HISTORIAL')).toBeNull();
    delete process.env['AIRTABLE_TABLE_HISTORIAL'];
  });

  it('handles all four recognised entity keys', () => {
    const keys = [
      'AIRTABLE_TABLE_RESIDENTES',
      'AIRTABLE_TABLE_PROPIEDADES',
      'AIRTABLE_TABLE_PAGOS',
      'AIRTABLE_TABLE_HISTORIAL',
    ] as const;

    for (const key of keys) {
      process.env[key] = `tbl_${key}`;
    }

    for (const key of keys) {
      expect(resolveEntityTableEnvKey(key)).toBe(`tbl_${key}`);
      delete process.env[key];
    }
  });
});
