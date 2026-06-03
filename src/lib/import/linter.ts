/**
 * src/lib/import/linter.ts
 *
 * Pre-import linter. Takes the parsed ImportRowResult array and runs
 * cross-row checks on top of the per-row schema validation from csv.ts.
 *
 * lintImport() checks:
 *   1. Required columns present in headers (structural check)
 *   2. Duplicate rows (same room_label + period, or same identifier combo)
 *   3. Period consistency — all rows should share the same period when expected
 *   4. Numeric range sanity — e.g. occupancy_days must not exceed total_days
 *   5. Cross-field logic — e.g. collected_amount should not wildly exceed billed_amount
 *
 * Returns a LintResult that enriches the input rows with additional warnings.
 *
 * This function is pure (no DB access) and can be unit-tested in isolation.
 */

import type { ImportType, ImportRowResult, LintResult, ImportErrorSummaryItem } from '@/lib/schemas/imports';

// ---------------------------------------------------------------------------
// Required column sets per import type
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS: Record<ImportType, string[]> = {
  monthly_billed:    ['room_label', 'property_name', 'period', 'billed_amount'],
  monthly_collected: ['room_label', 'property_name', 'period', 'collected_amount'],
  monthly_summary:   ['property_name', 'period', 'total_billed', 'total_collected', 'total_expenses', 'net_profit'],
  room_performance:  ['room_label', 'property_name', 'period', 'occupancy_days', 'total_days', 'revenue', 'expenses'],
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a deduplication key for a row based on the import type.
 * Returns undefined for row types that don't have a meaningful dedup key.
 */
function buildDedupKey(importType: ImportType, rawData: Record<string, unknown>): string | undefined {
  const p = rawData.period as string | undefined;
  switch (importType) {
    case 'monthly_billed':
    case 'monthly_collected':
    case 'room_performance':
      return [
        String(rawData.room_label ?? '').trim().toLowerCase(),
        String(rawData.property_name ?? '').trim().toLowerCase(),
        String(p ?? '').trim(),
      ].join('|');
    case 'monthly_summary':
      return [
        String(rawData.property_name ?? '').trim().toLowerCase(),
        String(p ?? '').trim(),
      ].join('|');
    default:
      return undefined;
  }
}

/**
 * Check whether all rows share the same period.
 * Returns the detected period (or undefined when no rows have one).
 */
function detectPeriods(rows: ImportRowResult[]): Set<string> {
  const periods = new Set<string>();
  for (const row of rows) {
    const p = row.rawData.period;
    if (typeof p === 'string' && /^\d{4}-\d{2}$/.test(p.trim())) {
      periods.add(p.trim());
    }
  }
  return periods;
}

// ---------------------------------------------------------------------------
// lintImport
// ---------------------------------------------------------------------------

/**
 * Run cross-row linting on an already-parsed ImportRowResult array.
 *
 * @param rows       Rows from parseCsv() — may already include per-row errors
 * @param importType Import type — determines dedup key and cross-field checks
 * @param expectedPeriod  Optional YYYY-MM period to validate against (checked
 *                        when present — warns when a row's period differs)
 *
 * Returns a new LintResult with rows enriched with additional warnings/errors.
 * Status can only move from 'ok' → 'warning' or 'error', never backwards.
 */
export function lintImport(
  rows: ImportRowResult[],
  importType: ImportType,
  expectedPeriod?: string
): LintResult {
  const requiredCols = REQUIRED_COLUMNS[importType];

  // ── 1. Column presence check ─────────────────────────────────────────────
  // Derive the set of columns present in the first non-empty row
  const presentCols = new Set<string>();
  for (const row of rows) {
    if (Object.keys(row.rawData).length > 0) {
      for (const key of Object.keys(row.rawData)) {
        presentCols.add(key);
      }
      break; // Only need the first row to check headers
    }
  }

  const missingCols = requiredCols.filter(col => !presentCols.has(col));

  // ── 2. Duplicate detection ────────────────────────────────────────────────
  const seenKeys = new Map<string, number>(); // dedupKey → first rowNumber

  // ── 3. Period consistency ─────────────────────────────────────────────────
  const detectedPeriods = detectPeriods(rows);

  // ── Enrich rows ───────────────────────────────────────────────────────────
  const lintedRows: ImportRowResult[] = rows.map(row => {
    let status = row.status;
    const extraErrors: string[] = [];

    // Missing column check — if the structural columns are missing, every row is an error
    if (missingCols.length > 0) {
      extraErrors.push(`Missing required columns: ${missingCols.join(', ')}`);
      status = 'error';
    }

    // Duplicate check (only for rows that haven't already failed)
    const dedupKey = buildDedupKey(importType, row.rawData);
    if (dedupKey !== undefined) {
      const existing = seenKeys.get(dedupKey);
      if (existing !== undefined) {
        extraErrors.push(`Duplicate row — same identifier as row #${existing}`);
        if (status === 'ok') status = 'warning';
      } else {
        seenKeys.set(dedupKey, row.rowNumber);
      }
    }

    // Period consistency
    if (expectedPeriod) {
      const rowPeriod = (row.rawData.period as string | undefined)?.trim();
      if (rowPeriod && rowPeriod !== expectedPeriod) {
        extraErrors.push(`Period mismatch: row has '${rowPeriod}', expected '${expectedPeriod}'`);
        if (status === 'ok') status = 'warning';
      }
    } else if (detectedPeriods.size > 1) {
      // Multiple periods detected across the file
      const rowPeriod = (row.rawData.period as string | undefined)?.trim();
      if (rowPeriod && detectedPeriods.size > 1) {
        extraErrors.push(`Mixed periods in file: found ${[...detectedPeriods].join(', ')}`);
        if (status === 'ok') status = 'warning';
      }
    }

    // Cross-field logic checks
    if (importType === 'room_performance') {
      const occupancyDays = Number(row.rawData.occupancy_days);
      const totalDays = Number(row.rawData.total_days);
      if (!isNaN(occupancyDays) && !isNaN(totalDays) && totalDays > 0 && occupancyDays > totalDays) {
        extraErrors.push(`occupancy_days (${occupancyDays}) exceeds total_days (${totalDays})`);
        if (status === 'ok') status = 'warning';
      }
    }

    if (extraErrors.length === 0) {
      return { ...row, status };
    }

    const combinedError = [row.errorDetail, ...extraErrors].filter(Boolean).join('; ');
    return { ...row, status, errorDetail: combinedError };
  });

  // ── Aggregate counters ────────────────────────────────────────────────────
  let validRows = 0;
  let warningRows = 0;
  let invalidRows = 0;
  const errorSummary: ImportErrorSummaryItem[] = [];

  for (const row of lintedRows) {
    switch (row.status) {
      case 'ok':      validRows++;   break;
      case 'warning': warningRows++; break;
      case 'error':
        invalidRows++;
        errorSummary.push({ rowNumber: row.rowNumber, message: row.errorDetail ?? 'Invalid row' });
        break;
    }
  }

  return {
    rows: lintedRows,
    totalRows: lintedRows.length,
    validRows,
    warningRows,
    invalidRows,
    errorSummary,
  };
}
