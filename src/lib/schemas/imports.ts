/**
 * src/lib/schemas/imports.ts
 *
 * Zod schemas for the CSV import workflow:
 *   - Per-import-type row shapes (MonthlyBilledRow, MonthlyCollectedRow, MonthlySummaryRow, RoomPerformanceRow)
 *   - ImportRowResult — the per-row output after parsing + lint
 *   - ImportDryRunResult — the aggregated summary returned to the caller
 *   - ImportCommitResult — confirmation payload
 *   - LintResult — the result of lintImport()
 *
 * NEVER import this file in 'use client' components — server-only.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed CSV upload size in bytes (5 MB). AC21. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** All valid import types */
export const IMPORT_TYPES = ['monthly_billed', 'monthly_collected', 'monthly_summary', 'room_performance'] as const;
export type ImportType = typeof IMPORT_TYPES[number];

// ---------------------------------------------------------------------------
// Per-type row schemas
// These match the expected CSV column headers for each report type.
// ---------------------------------------------------------------------------

/**
 * Monthly Billed CSV row — one row per room per billing period.
 * Expected columns: room_label, property_name, period, billed_amount
 */
export const MonthlyBilledRowSchema = z.object({
  room_label:    z.string().min(1, 'room_label is required'),
  property_name: z.string().min(1, 'property_name is required'),
  period:        z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
  billed_amount: z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'billed_amount must be numeric' }).min(0)
  ),
});
export type MonthlyBilledRow = z.infer<typeof MonthlyBilledRowSchema>;

/**
 * Monthly Collected CSV row — one row per room per billing period.
 * Expected columns: room_label, property_name, period, collected_amount
 */
export const MonthlyCollectedRowSchema = z.object({
  room_label:       z.string().min(1, 'room_label is required'),
  property_name:    z.string().min(1, 'property_name is required'),
  period:           z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
  collected_amount: z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'collected_amount must be numeric' }).min(0)
  ),
});
export type MonthlyCollectedRow = z.infer<typeof MonthlyCollectedRowSchema>;

/**
 * Monthly Summary CSV row — aggregated per property per period.
 * Expected columns: property_name, period, total_billed, total_collected, total_expenses, net_profit
 */
export const MonthlySummaryRowSchema = z.object({
  property_name:    z.string().min(1, 'property_name is required'),
  period:           z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
  total_billed:     z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'total_billed must be numeric' }).min(0)
  ),
  total_collected:  z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'total_collected must be numeric' }).min(0)
  ),
  total_expenses:   z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'total_expenses must be numeric' }).min(0)
  ),
  net_profit:       z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'net_profit must be numeric' })
  ),
});
export type MonthlySummaryRow = z.infer<typeof MonthlySummaryRowSchema>;

/**
 * Room Performance CSV row — one row per room per period.
 * Expected columns: room_label, property_name, period, occupancy_days, total_days, revenue, expenses
 */
export const RoomPerformanceRowSchema = z.object({
  room_label:     z.string().min(1, 'room_label is required'),
  property_name:  z.string().min(1, 'property_name is required'),
  period:         z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
  occupancy_days: z.preprocess(
    (val) => (typeof val === 'string' ? parseInt(val, 10) : val),
    z.number({ invalid_type_error: 'occupancy_days must be numeric' }).int().min(0)
  ),
  total_days:     z.preprocess(
    (val) => (typeof val === 'string' ? parseInt(val, 10) : val),
    z.number({ invalid_type_error: 'total_days must be numeric' }).int().min(1)
  ),
  revenue:        z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'revenue must be numeric' }).min(0)
  ),
  expenses:       z.preprocess(
    (val) => (typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val),
    z.number({ invalid_type_error: 'expenses must be numeric' }).min(0)
  ),
});
export type RoomPerformanceRow = z.infer<typeof RoomPerformanceRowSchema>;

// ---------------------------------------------------------------------------
// Union of all row types
// ---------------------------------------------------------------------------
export type AnyImportRow = MonthlyBilledRow | MonthlyCollectedRow | MonthlySummaryRow | RoomPerformanceRow;

// ---------------------------------------------------------------------------
// Per-row result after parsing + validation
// ---------------------------------------------------------------------------

/** Status of a single import row after validation */
export type ImportRowStatus = 'ok' | 'warning' | 'error';

/** Result for a single CSV row after parsing + lint */
export interface ImportRowResult {
  rowNumber: number;
  /** Raw key-value map from the CSV */
  rawData: Record<string, unknown>;
  /** Normalised + typed row data (undefined when status is 'error') */
  normalizedData?: AnyImportRow;
  status: ImportRowStatus;
  /** Human-readable error or warning message for this row */
  errorDetail?: string;
}

// ---------------------------------------------------------------------------
// Error summary item
// ---------------------------------------------------------------------------
export interface ImportErrorSummaryItem {
  rowNumber: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Dry-run result — returned by uploadCsvDryRun
// ---------------------------------------------------------------------------

/** Aggregated result of a CSV dry-run pass (no DB writes except csv_imports row) */
export interface ImportDryRunResult {
  csvImportId: string;
  importType: ImportType;
  period: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  /** Detailed per-row results (capped at first 100 for API response) */
  rows: ImportRowResult[];
  /** High-level error summary for display (same cap) */
  errorSummary: ImportErrorSummaryItem[];
}

// ---------------------------------------------------------------------------
// Commit result — returned by commitCsvImport
// ---------------------------------------------------------------------------

export interface ImportCommitResult {
  csvImportId: string;
  rowsWritten: number;
  committedAt: string;
}

// ---------------------------------------------------------------------------
// Lint result — returned by lintImport()
// ---------------------------------------------------------------------------

export interface LintResult {
  rows: ImportRowResult[];
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  errorSummary: ImportErrorSummaryItem[];
}

// ---------------------------------------------------------------------------
// Server Action input schemas
// ---------------------------------------------------------------------------

/** Schema for the period field in upload actions */
export const PeriodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM format (e.g. 2024-01)');

/** Schema for importType in upload actions */
export const ImportTypeSchema = z.enum(IMPORT_TYPES);

/** Schema for commitCsvImport */
export const CommitImportSchema = z.object({
  importId: z.string().uuid('importId must be a valid UUID'),
});

/** Schema for getImportLogs pagination */
export const GetImportLogsSchema = z.object({
  page:   z.coerce.number().int().min(0).default(0),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['dry_run', 'committed', 'failed']).optional(),
});
