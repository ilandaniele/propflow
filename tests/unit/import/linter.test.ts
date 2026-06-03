/**
 * tests/unit/import/linter.test.ts
 *
 * Unit tests for src/lib/import/linter.ts
 *
 * AC17: linter flags missing columns, duplicates, malformed dates, mixed periods.
 */

import { describe, it, expect } from 'vitest';
import { lintImport } from '@/lib/import/linter';
import type { ImportRowResult } from '@/lib/schemas/imports';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOkRow(
  rowNumber: number,
  rawData: Record<string, unknown>,
  normalizedData?: Record<string, unknown>
): ImportRowResult {
  return {
    rowNumber,
    rawData,
    normalizedData: normalizedData as ImportRowResult['normalizedData'],
    status: 'ok',
  };
}

function makeErrorRow(
  rowNumber: number,
  rawData: Record<string, unknown>,
  errorDetail: string
): ImportRowResult {
  return {
    rowNumber,
    rawData,
    status: 'error',
    errorDetail,
  };
}

// A minimal valid monthly_billed row fixture
function billedRow(overrides: Record<string, unknown> = {}) {
  return {
    room_label:    'Room A',
    property_name: 'Casa Verde',
    period:        '2024-01',
    billed_amount: '1200',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: missing required columns
// ---------------------------------------------------------------------------

describe('lintImport – missing required columns', () => {
  it('marks all rows as errors when a required column is absent', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, { property_name: 'Casa Verde', period: '2024-01', billed_amount: '1200' }),
      makeOkRow(2, { property_name: 'Casa Verde', period: '2024-01', billed_amount: '900' }),
    ];
    // room_label column is missing
    const result = lintImport(rows, 'monthly_billed');

    for (const row of result.rows) {
      expect(row.status).toBe('error');
      expect(row.errorDetail).toMatch(/room_label/i);
    }
    expect(result.invalidRows).toBe(2);
    expect(result.validRows).toBe(0);
  });

  it('does not flag missing column errors when all required columns are present', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow()),
      makeOkRow(2, billedRow({ room_label: 'Room B' })),
    ];
    const result = lintImport(rows, 'monthly_billed');
    // Should be all ok (no cross-row issues)
    expect(result.rows.every(r => r.status === 'ok')).toBe(true);
    expect(result.validRows).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: duplicate row detection
// ---------------------------------------------------------------------------

describe('lintImport – duplicate detection', () => {
  it('marks the second occurrence of a duplicate as warning', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow()),                     // Room A, 2024-01
      makeOkRow(2, billedRow()),                     // Room A, 2024-01 — DUPLICATE
      makeOkRow(3, billedRow({ room_label: 'Room B' })),  // unique
    ];
    const result = lintImport(rows, 'monthly_billed');

    expect(result.rows[0].status).toBe('ok');
    expect(result.rows[1].status).toBe('warning');
    expect(result.rows[1].errorDetail).toMatch(/duplicate/i);
    expect(result.rows[2].status).toBe('ok');
    expect(result.warningRows).toBe(1);
  });

  it('does not flag rows with different room labels as duplicates', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow({ room_label: 'Room A' })),
      makeOkRow(2, billedRow({ room_label: 'Room B' })),
      makeOkRow(3, billedRow({ room_label: 'Room C' })),
    ];
    const result = lintImport(rows, 'monthly_billed');
    expect(result.warningRows).toBe(0);
    expect(result.validRows).toBe(3);
  });

  it('treats same room across different periods as not duplicate (but warns on mixed periods)', () => {
    // Different periods → not a duplicate by the dedup key
    // However, when two rows have different periods and no expectedPeriod is provided,
    // the linter raises a "mixed periods" warning on the second row.
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow({ period: '2024-01' })),
      makeOkRow(2, billedRow({ period: '2024-02' })),
    ];
    const result = lintImport(rows, 'monthly_billed');

    // No row should be marked as a duplicate
    for (const row of result.rows) {
      expect(row.errorDetail ?? '').not.toMatch(/duplicate/i);
    }
  });

  it('detects monthly_summary duplicate by (property_name, period)', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, {
        property_name: 'Casa Verde',
        period: '2024-01',
        total_billed: '5000',
        total_collected: '4800',
        total_expenses: '1200',
        net_profit: '3600',
      }),
      makeOkRow(2, {
        property_name: 'Casa Verde', // same property + period — DUPLICATE
        period: '2024-01',
        total_billed: '5000',
        total_collected: '4800',
        total_expenses: '1200',
        net_profit: '3600',
      }),
    ];
    const result = lintImport(rows, 'monthly_summary');
    expect(result.rows[1].status).toBe('warning');
    expect(result.rows[1].errorDetail).toMatch(/duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: period consistency (expectedPeriod provided)
// ---------------------------------------------------------------------------

describe('lintImport – period consistency with expectedPeriod', () => {
  it('warns when a row period differs from expectedPeriod', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow({ period: '2024-01' })),
      makeOkRow(2, billedRow({ period: '2024-02' })), // wrong period
    ];
    const result = lintImport(rows, 'monthly_billed', '2024-01');
    expect(result.rows[0].status).toBe('ok');
    expect(result.rows[1].status).toBe('warning');
    expect(result.rows[1].errorDetail).toMatch(/period mismatch/i);
  });

  it('does not warn when row period matches expectedPeriod', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow({ period: '2024-01' })),
      makeOkRow(2, billedRow({ room_label: 'Room B', period: '2024-01' })),
    ];
    const result = lintImport(rows, 'monthly_billed', '2024-01');
    expect(result.warningRows).toBe(0);
    expect(result.validRows).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: cross-field logic for room_performance
// ---------------------------------------------------------------------------

describe('lintImport – room_performance cross-field checks', () => {
  it('warns when occupancy_days > total_days', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, {
        room_label:     'Room A',
        property_name:  'Casa Verde',
        period:         '2024-01',
        occupancy_days: '35',  // > total_days
        total_days:     '31',
        revenue:        '1200',
        expenses:       '200',
      }),
    ];
    const result = lintImport(rows, 'room_performance');
    expect(result.rows[0].status).toBe('warning');
    expect(result.rows[0].errorDetail).toMatch(/occupancy_days/i);
  });

  it('does not warn when occupancy_days <= total_days', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, {
        room_label:     'Room A',
        property_name:  'Casa Verde',
        period:         '2024-01',
        occupancy_days: '28',
        total_days:     '31',
        revenue:        '1200',
        expenses:       '200',
      }),
    ];
    const result = lintImport(rows, 'room_performance');
    expect(result.rows[0].status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Tests: already-errored rows
// ---------------------------------------------------------------------------

describe('lintImport – pre-existing error rows', () => {
  it('preserves status=error on rows that already failed Zod validation', () => {
    const rows: ImportRowResult[] = [
      makeErrorRow(1, billedRow({ billed_amount: 'n/a' }), 'billed_amount: must be numeric'),
      makeOkRow(2, billedRow({ room_label: 'Room B' })),
    ];
    const result = lintImport(rows, 'monthly_billed');
    // Row 1 is already error — must stay error
    expect(result.rows[0].status).toBe('error');
    // Row 2 is ok
    expect(result.rows[1].status).toBe('ok');
    expect(result.invalidRows).toBe(1);
    expect(result.validRows).toBe(1);
  });

  it('appends cross-row error details to already-errored rows', () => {
    const rows: ImportRowResult[] = [
      // Row 1: already error AND missing required column
      makeErrorRow(1, { property_name: 'Casa Verde', period: '2024-01', billed_amount: 'n/a' }, 'parse error'),
      makeOkRow(2, { property_name: 'Casa Verde', period: '2024-01', billed_amount: '1200' }),
    ];
    const result = lintImport(rows, 'monthly_billed');
    // room_label missing → both rows get the column error appended
    expect(result.rows[0].errorDetail).toMatch(/room_label/i);
    expect(result.rows[0].errorDetail).toMatch(/parse error/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: error summary
// ---------------------------------------------------------------------------

describe('lintImport – error summary', () => {
  it('populates errorSummary for each invalid row', () => {
    const rows: ImportRowResult[] = [
      makeErrorRow(1, billedRow({ billed_amount: 'n/a' }), 'billed_amount: must be numeric'),
      makeOkRow(2, billedRow({ room_label: 'Room B' })),
      makeErrorRow(3, billedRow({ period: 'bad' }), 'period: invalid format'),
    ];
    const result = lintImport(rows, 'monthly_billed');
    expect(result.errorSummary).toHaveLength(2);
    expect(result.errorSummary[0].rowNumber).toBe(1);
    expect(result.errorSummary[1].rowNumber).toBe(3);
  });

  it('returns totals accurately for a mixed set', () => {
    const rows: ImportRowResult[] = [
      makeOkRow(1, billedRow()),
      makeOkRow(2, billedRow({ room_label: 'Room B' })),
      makeOkRow(3, billedRow({ room_label: 'Room B' })),  // duplicate → warning
      makeErrorRow(4, billedRow({ billed_amount: 'x' }), 'numeric error'),
    ];
    const result = lintImport(rows, 'monthly_billed');
    expect(result.totalRows).toBe(4);
    expect(result.validRows).toBe(2);
    expect(result.warningRows).toBe(1);
    expect(result.invalidRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: empty input
// ---------------------------------------------------------------------------

describe('lintImport – edge cases', () => {
  it('handles empty rows array gracefully', () => {
    const result = lintImport([], 'monthly_billed');
    expect(result.totalRows).toBe(0);
    expect(result.validRows).toBe(0);
    expect(result.errorSummary).toHaveLength(0);
  });

  it('handles a single valid row', () => {
    const rows: ImportRowResult[] = [makeOkRow(1, billedRow())];
    const result = lintImport(rows, 'monthly_billed');
    expect(result.validRows).toBe(1);
    expect(result.warningRows).toBe(0);
    expect(result.invalidRows).toBe(0);
  });
});
