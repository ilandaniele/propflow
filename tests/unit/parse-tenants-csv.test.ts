/**
 * tests/unit/parse-tenants-csv.test.ts
 *
 * Tests for src/lib/csv/parseTenantsCsv.ts
 */

import { describe, it, expect } from 'vitest';
import { parseTenantsCsv } from '@/lib/csv/parseTenantsCsv';

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

const BASE_HEADERS = ['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'status', 'preferred_language'];

describe('parseTenantsCsv — valid row', () => {
  it('returns action: create for a valid new row', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['María', 'García', 'maria@example.com', '999888777', '1990-05-15', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create');
    expect(rows[0].email).toBe('maria@example.com');
    expect(rows[0].first_name).toBe('María');
  });

  it('normalizes email to lowercase', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['Juan', 'Perez', 'JUAN@EXAMPLE.COM', '111222333', '1985-01-01', 'active', 'es'],
    ]);
    const { rows } = parseTenantsCsv(csv);
    expect(rows[0].email).toBe('juan@example.com');
  });

  it('defaults preferred_language to es when empty', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['Ana', 'López', 'ana@example.com', '123456', '1992-07-20', 'active', ''],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].preferred_language).toBe('es');
  });
});

describe('parseTenantsCsv — invalid rows', () => {
  it('returns action: invalid when first_name is missing', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['', 'García', 'maria@example.com', '999', '1990-05-15', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'first_name')).toBe(true);
    expect(rows[0].action).toBe('invalid');
  });

  it('returns action: invalid when email is missing', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['María', 'García', '', '999', '1990-05-15', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'email')).toBe(true);
    expect(rows[0].action).toBe('invalid');
  });

  it('returns action: invalid for malformed email address', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['María', 'García', 'not-an-email', '999', '1990-05-15', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'email')).toBe(true);
    expect(rows[0].action).toBe('invalid');
  });

  it('returns action: invalid for invalid date_of_birth format', () => {
    const csv = buildCsv(BASE_HEADERS, [
      ['María', 'García', 'maria@example.com', '999', '15/05/1990', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'date_of_birth')).toBe(true);
    expect(rows[0].action).toBe('invalid');
  });
});

describe('parseTenantsCsv — duplicate email in batch', () => {
  it('both rows parse as create (conflict detection is caller responsibility)', () => {
    // parseTenantsCsv itself does not detect duplicates — the API route does DB lookup
    const csv = buildCsv(BASE_HEADERS, [
      ['María', 'García', 'dup@example.com', '999', '1990-05-15', 'active', 'es'],
      ['María', 'García', 'dup@example.com', '999', '1990-05-15', 'active', 'es'],
    ]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe('create');
    expect(rows[1].action).toBe('create');
    expect(rows[0].email).toBe('dup@example.com');
    expect(rows[1].email).toBe('dup@example.com');
  });
});

describe('parseTenantsCsv — required header missing', () => {
  it('returns file-level error when first_name column is absent', () => {
    // Build CSV without the first_name column
    const csv = buildCsv(['last_name', 'email'], [['García', 'test@x.com']]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'first_name')).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('returns file-level error when email column is absent', () => {
    const csv = buildCsv(['first_name', 'last_name'], [['María', 'García']]);
    const { rows, errors } = parseTenantsCsv(csv);
    expect(errors.some(e => e.field === 'email')).toBe(true);
    expect(rows).toHaveLength(0);
  });
});
