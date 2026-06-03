/**
 * tests/unit/import/csv.test.ts
 *
 * Unit tests for src/lib/import/csv.ts
 *
 * AC17: parseCsv returns per-row results with status flags.
 * AC21: Buffer > 5 MB is rejected with FILE_TOO_LARGE before any parsing.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, CSV_ERROR_CODES } from '@/lib/import/csv';
import { MAX_CSV_BYTES } from '@/lib/schemas/imports';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCsvBuffer(csvText: string): Buffer {
  return Buffer.from(csvText, 'utf-8');
}

/** Build a CSV string with the given column names and rows */
function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.join(',');
  const rowLines = rows.map(r => r.join(','));
  return [headerLine, ...rowLines].join('\n');
}

// ---------------------------------------------------------------------------
// monthly_billed CSV fixtures
// ---------------------------------------------------------------------------

const VALID_BILLED_CSV = buildCsv(
  ['room_label', 'property_name', 'period', 'billed_amount'],
  [
    ['Room A', 'Casa Verde', '2024-01', '1200.00'],
    ['Room B', 'Casa Verde', '2024-01', '950.50'],
    ['Room C', 'Casa Azul', '2024-01', '1100.00'],
  ]
);

const INVALID_BILLED_CSV = buildCsv(
  ['room_label', 'property_name', 'period', 'billed_amount'],
  [
    ['Room A', 'Casa Verde', '2024-01', '1200.00'],
    ['', 'Casa Verde', '2024-01', '950.50'],          // missing room_label
    ['Room C', 'Casa Azul', 'not-a-date', '1100.00'],  // bad period
    ['Room D', 'Casa Azul', '2024-01', 'n/a'],         // non-numeric amount
  ]
);

const MONTHLY_COLLECTED_CSV = buildCsv(
  ['room_label', 'property_name', 'period', 'collected_amount'],
  [
    ['Room A', 'Casa Verde', '2024-02', '1100'],
    ['Room B', 'Casa Verde', '2024-02', '900'],
  ]
);

// ---------------------------------------------------------------------------
// Tests: file size guard (AC21)
// ---------------------------------------------------------------------------

describe('parseCsv – file size guard (AC21)', () => {
  it('rejects a buffer larger than 5 MB with FILE_TOO_LARGE', () => {
    // Build a buffer slightly larger than the limit
    const oversized = Buffer.alloc(MAX_CSV_BYTES + 1, 'x');
    const result = parseCsv(oversized, 'monthly_billed');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CSV_ERROR_CODES.FILE_TOO_LARGE);
      expect(result.error.message).toMatch(/5 MB/i);
    }
  });

  it('accepts a buffer exactly at the limit', () => {
    // A buffer of exactly MAX_CSV_BYTES but valid CSV content (just padding + header)
    const headerLine = 'room_label,property_name,period,billed_amount\n';
    const remaining = MAX_CSV_BYTES - headerLine.length;
    // Fill with valid rows
    const validRow = 'Room A,Casa Verde,2024-01,1200\n';
    const repeatCount = Math.floor(remaining / validRow.length);
    const content = headerLine + validRow.repeat(repeatCount);
    const buffer = Buffer.from(content, 'utf-8');

    // Must be within limit
    expect(buffer.byteLength).toBeLessThanOrEqual(MAX_CSV_BYTES);

    const result = parseCsv(buffer, 'monthly_billed');
    expect(result.ok).toBe(true);
  });

  it('rejects a Uint8Array larger than 5 MB with FILE_TOO_LARGE', () => {
    const oversized = new Uint8Array(MAX_CSV_BYTES + 100);
    const result = parseCsv(oversized, 'monthly_billed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CSV_ERROR_CODES.FILE_TOO_LARGE);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: valid CSV parsing (AC17)
// ---------------------------------------------------------------------------

describe('parseCsv – monthly_billed valid CSV', () => {
  it('returns ok=true for a well-formed CSV', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
  });

  it('returns the correct totalRows count', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.totalRows).toBe(3);
    }
  });

  it('marks all valid rows as status=ok', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const row of result.result.rows) {
        expect(row.status).toBe('ok');
      }
    }
  });

  it('includes normalizedData on ok rows', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const firstRow = result.result.rows[0];
      expect(firstRow.normalizedData).toBeDefined();
      expect((firstRow.normalizedData as { room_label: string }).room_label).toBe('Room A');
    }
  });

  it('assigns sequential rowNumbers starting at 1', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rowNumbers = result.result.rows.map(r => r.rowNumber);
      expect(rowNumbers).toEqual([1, 2, 3]);
    }
  });

  it('preserves rawData for all rows', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.rows[0].rawData).toMatchObject({
        room_label: 'Room A',
        property_name: 'Casa Verde',
        period: '2024-01',
        billed_amount: '1200.00',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: invalid rows
// ---------------------------------------------------------------------------

describe('parseCsv – monthly_billed invalid rows', () => {
  it('marks rows with missing room_label as status=error', () => {
    const result = parseCsv(makeCsvBuffer(INVALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row2 = result.result.rows[1]; // empty room_label
      expect(row2.status).toBe('error');
      expect(row2.errorDetail).toBeDefined();
    }
  });

  it('marks rows with malformed period as status=error', () => {
    const result = parseCsv(makeCsvBuffer(INVALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row3 = result.result.rows[2]; // bad period format
      expect(row3.status).toBe('error');
      expect(row3.errorDetail).toMatch(/period/i);
    }
  });

  it('marks rows with non-numeric billed_amount as status=error', () => {
    const result = parseCsv(makeCsvBuffer(INVALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row4 = result.result.rows[3]; // non-numeric amount
      expect(row4.status).toBe('error');
      expect(row4.errorDetail).toMatch(/billed_amount/i);
    }
  });

  it('valid rows among invalid ones still return status=ok', () => {
    const result = parseCsv(makeCsvBuffer(INVALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.rows[0].status).toBe('ok');
    }
  });

  it('does not include normalizedData on error rows', () => {
    const result = parseCsv(makeCsvBuffer(INVALID_BILLED_CSV), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const errorRow = result.result.rows.find(r => r.status === 'error');
      expect(errorRow?.normalizedData).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: monthly_collected
// ---------------------------------------------------------------------------

describe('parseCsv – monthly_collected', () => {
  it('parses collected CSV with correct schema', () => {
    const result = parseCsv(makeCsvBuffer(MONTHLY_COLLECTED_CSV), 'monthly_collected');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.totalRows).toBe(2);
      expect(result.result.rows[0].status).toBe('ok');
      expect((result.result.rows[0].normalizedData as { collected_amount: number }).collected_amount).toBe(1100);
    }
  });

  it('errors on rows with missing collected_amount', () => {
    const badCsv = buildCsv(
      ['room_label', 'property_name', 'period', 'collected_amount'],
      [['Room A', 'Casa Verde', '2024-02', '']]
    );
    const result = parseCsv(makeCsvBuffer(badCsv), 'monthly_collected');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.rows[0].status).toBe('error');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: room_performance
// ---------------------------------------------------------------------------

describe('parseCsv – room_performance', () => {
  it('parses a valid room_performance CSV', () => {
    const csv = buildCsv(
      ['room_label', 'property_name', 'period', 'occupancy_days', 'total_days', 'revenue', 'expenses'],
      [['Room A', 'Casa Verde', '2024-03', '28', '31', '1200', '200']]
    );
    const result = parseCsv(makeCsvBuffer(csv), 'room_performance');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.rows[0].status).toBe('ok');
      const nd = result.result.rows[0].normalizedData as { occupancy_days: number; total_days: number };
      expect(nd.occupancy_days).toBe(28);
      expect(nd.total_days).toBe(31);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: no importType (raw mode)
// ---------------------------------------------------------------------------

describe('parseCsv – no importType (raw mode)', () => {
  it('returns rows without schema validation when importType is undefined', () => {
    const result = parseCsv(makeCsvBuffer(VALID_BILLED_CSV), undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // All rows ok because there is no validation
      for (const row of result.result.rows) {
        expect(row.status).toBe('ok');
        expect(row.normalizedData).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: numeric coercion
// ---------------------------------------------------------------------------

describe('parseCsv – numeric coercion', () => {
  it('handles comma-separated numbers like "1,200.50"', () => {
    const csv = buildCsv(
      ['room_label', 'property_name', 'period', 'billed_amount'],
      [['Room A', 'Casa Verde', '2024-01', '"1,200.50"']]
    );
    const result = parseCsv(makeCsvBuffer(csv), 'monthly_billed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const nd = result.result.rows[0].normalizedData as { billed_amount: number };
      // papaparse strips quotes; our schema does parseFloat after removing commas
      expect(typeof nd?.billed_amount).toBe('number');
    }
  });
});
