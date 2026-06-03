/**
 * src/lib/import/csv.ts
 *
 * Server-only CSV parsing layer.
 * parseCsv() takes a raw Buffer, validates the file size (AC21), parses with
 * papaparse, and returns an array of raw row objects. It does NOT write to the DB.
 *
 * The function is intentionally side-effect free so it can be unit-tested
 * without a database connection.
 *
 * AC21: CSV > 5 MB is rejected with FILE_TOO_LARGE before any parsing occurs.
 */

import Papa from 'papaparse';
import {
  MAX_CSV_BYTES,
  type ImportType,
  type ImportRowResult,
  MonthlyBilledRowSchema,
  MonthlyCollectedRowSchema,
  MonthlySummaryRowSchema,
  RoomPerformanceRowSchema,
} from '@/lib/schemas/imports';
import type { ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Public error codes (kept as constants so callers can branch without magic strings)
// ---------------------------------------------------------------------------
export const CSV_ERROR_CODES = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PARSE_ERROR:    'PARSE_ERROR',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the correct Zod schema for the given import type */
function getRowSchema(importType: ImportType): ZodSchema {
  switch (importType) {
    case 'monthly_billed':     return MonthlyBilledRowSchema;
    case 'monthly_collected':  return MonthlyCollectedRowSchema;
    case 'monthly_summary':    return MonthlySummaryRowSchema;
    case 'room_performance':   return RoomPerformanceRowSchema;
  }
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

export interface ParseCsvOptions {
  /**
   * The import type — selects the Zod schema used to validate each row.
   * Set to undefined to skip row validation (returns raw rows only).
   */
  importType?: ImportType;
}

export interface ParseCsvResult {
  /** All row results including ok / warning / error status */
  rows: ImportRowResult[];
  /** Total number of data rows (excluding header) */
  totalRows: number;
}

export interface ParseCsvError {
  code: typeof CSV_ERROR_CODES[keyof typeof CSV_ERROR_CODES];
  message: string;
}

/**
 * Parse a CSV buffer and return per-row validation results.
 *
 * @param buffer     Raw file bytes (from Server Action formData)
 * @param importType Import type — selects row schema; undefined skips validation
 * @returns          ParseCsvResult on success, ParseCsvError on size/parse failure
 *
 * Never throws — all errors are returned as ParseCsvError.
 *
 * AC21: Rejects buffers > MAX_CSV_BYTES before any parsing.
 */
export function parseCsv(
  buffer: Buffer | Uint8Array,
  importType?: ImportType
): { ok: true; result: ParseCsvResult } | { ok: false; error: ParseCsvError } {
  // AC21: enforce file size cap BEFORE parsing
  if (buffer.byteLength > MAX_CSV_BYTES) {
    return {
      ok: false,
      error: {
        code: CSV_ERROR_CODES.FILE_TOO_LARGE,
        message: `File size ${buffer.byteLength} bytes exceeds the 5 MB limit.`,
      },
    };
  }

  // Convert buffer to string for papaparse
  const csvText = Buffer.isBuffer(buffer)
    ? buffer.toString('utf-8')
    : Buffer.from(buffer).toString('utf-8');

  // Parse with papaparse (synchronous, header row enabled)
  const parseResult = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // Keep as strings; Zod schemas handle numeric coercion
    transformHeader: (header: string) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (parseResult.errors.length > 0) {
    // If there are fatal errors (e.g. BOM issues, structural problems) fail the whole parse
    const fatalErrors = parseResult.errors.filter(e => e.type === 'Delimiter' || e.type === 'FieldMismatch');
    if (fatalErrors.length > 0 && (parseResult.data?.length ?? 0) === 0) {
      return {
        ok: false,
        error: {
          code: CSV_ERROR_CODES.PARSE_ERROR,
          message: `CSV parse error: ${fatalErrors[0].message}`,
        },
      };
    }
  }

  const rawRows = parseResult.data ?? [];
  const schema = importType ? getRowSchema(importType) : null;

  const rows: ImportRowResult[] = rawRows.map((rawRow, index) => {
    const rowNumber = index + 1;

    if (!schema) {
      // No schema — return raw data as-is
      return {
        rowNumber,
        rawData: rawRow,
        status: 'ok' as const,
      };
    }

    // Validate the row against the schema
    const parsed = schema.safeParse(rawRow);

    if (parsed.success) {
      return {
        rowNumber,
        rawData: rawRow,
        normalizedData: parsed.data,
        status: 'ok' as const,
      };
    }

    // Build a human-readable error detail from Zod issues
    const errorDetail = parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    return {
      rowNumber,
      rawData: rawRow,
      status: 'error' as const,
      errorDetail,
    };
  });

  return {
    ok: true,
    result: {
      rows,
      totalRows: rows.length,
    },
  };
}
