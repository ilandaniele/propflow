'use server';

/**
 * src/app/actions/imports.ts
 *
 * CSV import Server Actions:
 *   uploadCsvDryRun — parse + lint a CSV, write csv_imports(status=dry_run), return summary
 *   commitCsvImport — set status=committed + committed_at, write import_rows
 *   getImportLogs   — paginated list of csv_imports for the current org
 *
 * AC17: dry-run creates csv_imports row with status='dry_run'; no import_rows written.
 * AC18: commit writes import_rows and sets csv_imports.status='committed' + committed_at.
 * AC21: file > 5 MB rejected with Errors.VALIDATION_ERROR { code: 'FILE_TOO_LARGE' }.
 * AC30: requireAdmin() + Zod validation + mutationRateLimit on mutations.
 */

import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors, ok } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { parseCsv, CSV_ERROR_CODES } from '@/lib/import/csv';
import { lintImport } from '@/lib/import/linter';
import {
  ImportTypeSchema,
  PeriodSchema,
  CommitImportSchema,
  GetImportLogsSchema,
  MAX_CSV_BYTES,
  type ImportDryRunResult,
  type ImportCommitResult,
  type ImportType,
} from '@/lib/schemas/imports';
import type { ActionResult } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cap row arrays sent over the wire to avoid massive Server Action payloads */
const MAX_ROWS_IN_RESPONSE = 100;

// ---------------------------------------------------------------------------
// uploadCsvDryRun
// ---------------------------------------------------------------------------

const UploadCsvDryRunSchema = z.object({
  importType: ImportTypeSchema,
  period:     PeriodSchema,
  filename:   z.string().min(1).max(255),
  /** File content encoded as base64 — avoids binary serialisation issues in Server Actions */
  fileBase64: z.string().min(1),
});

/**
 * AC17, AC21: Parse + lint a CSV file in dry-run mode.
 *
 * Creates a csv_imports row with status='dry_run'.
 * Does NOT write import_rows — that happens only on commitCsvImport.
 *
 * The caller should pass the file as base64 via formData('fileBase64').
 */
export async function uploadCsvDryRun(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportDryRunResult>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit
  const rl = mutationRateLimit(ctx.userId, 'uploadCsvDryRun');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate inputs
  const parsed = UploadCsvDryRunSchema.safeParse({
    importType: formData.get('importType'),
    period:     formData.get('period'),
    filename:   formData.get('filename'),
    fileBase64: formData.get('fileBase64'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { importType, period, filename, fileBase64 } = parsed.data;

  // 4. Decode file
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch {
    return Errors.VALIDATION_ERROR({ message: 'Invalid base64 file encoding' });
  }

  // AC21: reject oversized files
  if (fileBuffer.byteLength > MAX_CSV_BYTES) {
    return {
      error: {
        code: CSV_ERROR_CODES.FILE_TOO_LARGE,
        message: `File size ${fileBuffer.byteLength} bytes exceeds the 5 MB limit.`,
        details: { maxBytes: MAX_CSV_BYTES, actualBytes: fileBuffer.byteLength },
      },
    };
  }

  // 5. Parse CSV
  const parseOutcome = parseCsv(fileBuffer, importType as ImportType);
  if (!parseOutcome.ok) {
    if (parseOutcome.error.code === CSV_ERROR_CODES.FILE_TOO_LARGE) {
      return {
        error: {
          code: CSV_ERROR_CODES.FILE_TOO_LARGE,
          message: parseOutcome.error.message,
          details: { maxBytes: MAX_CSV_BYTES },
        },
      };
    }
    return Errors.VALIDATION_ERROR({ message: parseOutcome.error.message, code: parseOutcome.error.code });
  }

  const { rows: parsedRows } = parseOutcome.result;

  // 6. Lint
  const lintResult = lintImport(parsedRows, importType as ImportType, period);

  // 7. Insert csv_imports row with status='dry_run'
  const supabase = await createClient();
  const errorSummaryForDb = lintResult.errorSummary.slice(0, MAX_ROWS_IN_RESPONSE).map(e => ({
    row: e.rowNumber,
    message: e.message,
  }));

  const { data: importRow, error: insertError } = await supabase
    .from('csv_imports')
    .insert({
      org_id:            ctx.orgId,
      import_type:       importType,
      original_filename: filename,
      period,
      status:            'dry_run',
      row_count:         lintResult.totalRows,
      failed_count:      lintResult.invalidRows,
      error_summary:     errorSummaryForDb,
      created_by:        ctx.userId,
    })
    .select('id')
    .single();

  if (insertError || !importRow) {
    console.error('[uploadCsvDryRun] DB insert error:', insertError?.code ?? 'no-data');
    return Errors.INTERNAL();
  }

  // 8. Return dry-run result
  const result: ImportDryRunResult = {
    csvImportId: importRow.id as string,
    importType:  importType as ImportType,
    period,
    totalRows:   lintResult.totalRows,
    validRows:   lintResult.validRows,
    warningRows: lintResult.warningRows,
    invalidRows: lintResult.invalidRows,
    rows:        lintResult.rows.slice(0, MAX_ROWS_IN_RESPONSE),
    errorSummary: lintResult.errorSummary.slice(0, MAX_ROWS_IN_RESPONSE),
  };

  return ok<ImportDryRunResult>(result);
}

// ---------------------------------------------------------------------------
// commitCsvImport
// ---------------------------------------------------------------------------

/**
 * AC18: Commit a dry-run import.
 *
 * Sets csv_imports.status='committed' + committed_at.
 * Writes import_rows for all rows in the original parse.
 *
 * The dry-run rows are re-parsed from the stored csv_imports row — the caller
 * must re-supply the file because Server Actions are stateless.
 * Alternatively: store normalized rows in the dry-run step and commit them here.
 *
 * For this implementation we store the row data in import_rows during commit
 * and re-supply the file via formData to avoid storing unvalidated data in a
 * prior step.
 */
const CommitWithDataSchema = CommitImportSchema.extend({
  fileBase64: z.string().min(1),
  importType: ImportTypeSchema,
  period:     PeriodSchema,
});

export async function commitCsvImport(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportCommitResult>> {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Rate limit
  const rl = mutationRateLimit(ctx.userId, 'commitCsvImport');
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate
  const parsed = CommitWithDataSchema.safeParse({
    importId:   formData.get('importId'),
    fileBase64: formData.get('fileBase64'),
    importType: formData.get('importType'),
    period:     formData.get('period'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { importId, fileBase64, importType, period } = parsed.data;

  // 4. Load csv_imports row — verify it belongs to this org + is in dry_run status
  const supabase = await createClient();
  const { data: importRecord, error: fetchError } = await supabase
    .from('csv_imports')
    .select('id, org_id, status, import_type')
    .eq('id', importId)
    .single();

  if (fetchError || !importRecord) {
    return { error: { code: 'IMPORT_NOT_FOUND', message: 'Import record not found.' } };
  }

  // RLS guarantees org_id match — but double-check status
  if (importRecord.status !== 'dry_run') {
    return { error: { code: 'IMPORT_ALREADY_COMMITTED', message: 'This import has already been committed.' } };
  }

  // 5. Re-parse the file to get import rows
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch {
    return Errors.VALIDATION_ERROR({ message: 'Invalid base64 file encoding' });
  }

  // AC21: size check (shouldn't be needed again, but defensive)
  if (fileBuffer.byteLength > MAX_CSV_BYTES) {
    return {
      error: {
        code: CSV_ERROR_CODES.FILE_TOO_LARGE,
        message: `File size exceeds the 5 MB limit.`,
        details: { maxBytes: MAX_CSV_BYTES },
      },
    };
  }

  const parseOutcome = parseCsv(fileBuffer, importType as ImportType);
  if (!parseOutcome.ok) {
    return Errors.VALIDATION_ERROR({ message: parseOutcome.error.message, code: parseOutcome.error.code });
  }

  const lintResult = lintImport(parseOutcome.result.rows, importType as ImportType, period);

  // 6. Write import_rows in batches
  const importRowsToInsert = lintResult.rows.map(row => ({
    import_id:       importId,
    row_number:      row.rowNumber,
    raw_data:        row.rawData as Record<string, unknown>,
    normalized_data: (row.normalizedData ?? null) as Record<string, unknown> | null,
    status:          row.status,
    error_detail:    row.errorDetail ?? null,
  }));

  // Supabase has a 1000-row insert limit per call — batch in 500s
  const BATCH_SIZE = 500;
  for (let i = 0; i < importRowsToInsert.length; i += BATCH_SIZE) {
    const batch = importRowsToInsert.slice(i, i + BATCH_SIZE);
    const { error: rowsError } = await supabase
      .from('import_rows')
      .insert(batch);

    if (rowsError) {
      console.error('[commitCsvImport] import_rows insert error:', rowsError.code);
      // Attempt to mark import as failed
      await supabase
        .from('csv_imports')
        .update({ status: 'failed' })
        .eq('id', importId);
      return Errors.INTERNAL();
    }
  }

  // 7. Mark csv_imports as committed
  const committedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('csv_imports')
    .update({
      status:       'committed',
      committed_at: committedAt,
      row_count:    lintResult.totalRows,
      failed_count: lintResult.invalidRows,
    })
    .eq('id', importId);

  if (updateError) {
    console.error('[commitCsvImport] csv_imports update error:', updateError.code);
    return Errors.INTERNAL();
  }

  return ok<ImportCommitResult>({
    csvImportId: importId,
    rowsWritten: importRowsToInsert.length,
    committedAt,
  });
}

// ---------------------------------------------------------------------------
// getImportLogs
// ---------------------------------------------------------------------------

export interface ImportLogEntry {
  id: string;
  importType: string;
  originalFilename: string;
  period: string;
  status: string;
  rowCount: number;
  failedCount: number;
  committedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ImportLogsPage {
  items: ImportLogEntry[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Paginated list of csv_imports rows for the current org.
 * AC18: committed imports are visible in Import Logs.
 */
export async function getImportLogs(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportLogsPage>> {
  // 1. Auth — ctx not used directly; RLS scopes DB queries to current user's org
  try {
    await requireAdmin();
  } catch {
    return Errors.UNAUTHORIZED();
  }

  // 2. Validate pagination params
  const parsed = GetImportLogsSchema.safeParse({
    page:   formData.get('page'),
    limit:  formData.get('limit'),
    status: formData.get('status') || undefined,
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { page, limit, status } = parsed.data;
  const from = page * limit;
  const to   = from + limit - 1;

  // 3. Query
  const supabase = await createClient();
  let query = supabase
    .from('csv_imports')
    .select('id, import_type, original_filename, period, status, row_count, failed_count, committed_at, created_at, created_by', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error('[getImportLogs] query error:', error.code);
    return Errors.INTERNAL();
  }

  const items: ImportLogEntry[] = (data ?? []).map((row: {
    id: string;
    import_type: string;
    original_filename: string;
    period: string;
    status: string;
    row_count: number;
    failed_count: number;
    committed_at: string | null;
    created_at: string;
    created_by: string;
  }) => ({
    id:               row.id,
    importType:       row.import_type,
    originalFilename: row.original_filename,
    period:           row.period,
    status:           row.status,
    rowCount:         row.row_count,
    failedCount:      row.failed_count,
    committedAt:      row.committed_at,
    createdAt:        row.created_at,
    createdBy:        row.created_by,
  }));

  return ok<ImportLogsPage>({
    items,
    total: count ?? 0,
    page,
    limit,
  });
}
