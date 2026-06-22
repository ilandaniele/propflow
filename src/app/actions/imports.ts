'use server';

/**
 * src/app/actions/imports.ts
 *
 * CSV import Server Actions — rewritten to Drizzle ORM.
 *   uploadCsvDryRun  — parse + lint, write csv_imports(status=dry_run)
 *   commitCsvImport  — set committed + write import_rows
 *   getImportLogs    — paginated list for current org
 */

import { z } from 'zod';
import { db } from '@/lib/db';
import { csvImports, importRows } from '@/lib/db/schema';
import { eq, and, desc, count as drizzleCount } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
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

const MAX_ROWS_IN_RESPONSE = 100;

// ---------------------------------------------------------------------------
// uploadCsvDryRun
// ---------------------------------------------------------------------------

const UploadCsvDryRunSchema = z.object({
  importType: ImportTypeSchema,
  period:     PeriodSchema,
  filename:   z.string().min(1).max(255),
  fileBase64: z.string().min(1),
});

export async function uploadCsvDryRun(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportDryRunResult>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'uploadCsvDryRun');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UploadCsvDryRunSchema.safeParse({
    importType: formData.get('importType'),
    period:     formData.get('period'),
    filename:   formData.get('filename'),
    fileBase64: formData.get('fileBase64'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { importType, period, filename, fileBase64 } = parsed.data;

  let fileBuffer: Buffer;
  try { fileBuffer = Buffer.from(fileBase64, 'base64'); } catch {
    return Errors.VALIDATION_ERROR({ message: 'Invalid base64 file encoding' });
  }

  if (fileBuffer.byteLength > MAX_CSV_BYTES) {
    return {
      error: {
        code: CSV_ERROR_CODES.FILE_TOO_LARGE,
        message: `File size ${fileBuffer.byteLength} bytes exceeds the 5 MB limit.`,
        details: { maxBytes: MAX_CSV_BYTES, actualBytes: fileBuffer.byteLength },
      },
    };
  }

  const parseOutcome = parseCsv(fileBuffer, importType as ImportType);
  if (!parseOutcome.ok) {
    if (parseOutcome.error.code === CSV_ERROR_CODES.FILE_TOO_LARGE) {
      return { error: { code: CSV_ERROR_CODES.FILE_TOO_LARGE, message: parseOutcome.error.message, details: { maxBytes: MAX_CSV_BYTES } } };
    }
    return Errors.VALIDATION_ERROR({ message: parseOutcome.error.message, code: parseOutcome.error.code });
  }

  const { rows: parsedRows } = parseOutcome.result;
  const lintResult = lintImport(parsedRows, importType as ImportType, period);

  const errorSummaryForDb = lintResult.errorSummary.slice(0, MAX_ROWS_IN_RESPONSE).map(e => ({
    row: e.rowNumber,
    message: e.message,
  }));

  let importRowId: string;
  try {
    const rows = await db
      .insert(csvImports)
      .values({
        orgId:            ctx.orgId,
        importType,
        originalFilename: filename,
        period,
        status:           'dry_run',
        rowCount:         lintResult.totalRows,
        failedCount:      lintResult.invalidRows,
        errorSummary:     errorSummaryForDb,
        createdBy:        ctx.userId,
      })
      .returning({ id: csvImports.id });

    if (!rows[0]) throw new Error('No row returned');
    importRowId = rows[0].id;
  } catch (e) {
    console.error('[uploadCsvDryRun] DB insert error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }

  const result: ImportDryRunResult = {
    csvImportId: importRowId,
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

const CommitWithDataSchema = CommitImportSchema.extend({
  fileBase64: z.string().min(1),
  importType: ImportTypeSchema,
  period:     PeriodSchema,
});

export async function commitCsvImport(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportCommitResult>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutationRateLimit(ctx.userId, 'commitCsvImport');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = CommitWithDataSchema.safeParse({
    importId:   formData.get('importId'),
    fileBase64: formData.get('fileBase64'),
    importType: formData.get('importType'),
    period:     formData.get('period'),
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { importId, fileBase64, importType, period } = parsed.data;

  // Load csv_imports row — verify it belongs to this org + is in dry_run status
  const importRecordRows = await db
    .select({ id: csvImports.id, status: csvImports.status })
    .from(csvImports)
    .where(and(eq(csvImports.id, importId), eq(csvImports.orgId, ctx.orgId)))
    .limit(1);

  if (!importRecordRows[0]) {
    return { error: { code: 'IMPORT_NOT_FOUND', message: 'Import record not found.' } };
  }

  if (importRecordRows[0].status !== 'dry_run') {
    return { error: { code: 'IMPORT_ALREADY_COMMITTED', message: 'This import has already been committed.' } };
  }

  let fileBuffer: Buffer;
  try { fileBuffer = Buffer.from(fileBase64, 'base64'); } catch {
    return Errors.VALIDATION_ERROR({ message: 'Invalid base64 file encoding' });
  }

  if (fileBuffer.byteLength > MAX_CSV_BYTES) {
    return { error: { code: CSV_ERROR_CODES.FILE_TOO_LARGE, message: 'File size exceeds the 5 MB limit.', details: { maxBytes: MAX_CSV_BYTES } } };
  }

  const parseOutcome = parseCsv(fileBuffer, importType as ImportType);
  if (!parseOutcome.ok) {
    return Errors.VALIDATION_ERROR({ message: parseOutcome.error.message, code: parseOutcome.error.code });
  }

  const lintResult = lintImport(parseOutcome.result.rows, importType as ImportType, period);

  const importRowsToInsert = lintResult.rows.map(row => ({
    importId,
    rowNumber:      row.rowNumber,
    rawData:        row.rawData as Record<string, unknown>,
    normalizedData: (row.normalizedData ?? null) as Record<string, unknown> | null,
    status:         row.status,
    errorDetail:    row.errorDetail ?? null,
  }));

  // Batch insert in 500s
  const BATCH_SIZE = 500;
  for (let i = 0; i < importRowsToInsert.length; i += BATCH_SIZE) {
    const batch = importRowsToInsert.slice(i, i + BATCH_SIZE);
    try {
      await db.insert(importRows).values(batch);
    } catch (e) {
      console.error('[commitCsvImport] import_rows insert error:', e instanceof Error ? e.message : String(e));
      // Attempt to mark import as failed
      await db.update(csvImports).set({ status: 'failed' }).where(eq(csvImports.id, importId)).catch(() => undefined);
      return Errors.INTERNAL();
    }
  }

  const committedAt = new Date();
  try {
    await db
      .update(csvImports)
      .set({
        status:      'committed',
        committedAt,
        rowCount:    lintResult.totalRows,
        failedCount: lintResult.invalidRows,
      })
      .where(and(eq(csvImports.id, importId), eq(csvImports.orgId, ctx.orgId)));
  } catch (e) {
    console.error('[commitCsvImport] csv_imports update error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }

  return ok<ImportCommitResult>({
    csvImportId: importId,
    rowsWritten: importRowsToInsert.length,
    committedAt: committedAt.toISOString(),
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

export async function getImportLogs(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult<ImportLogsPage>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const parsed = GetImportLogsSchema.safeParse({
    page:   formData.get('page'),
    limit:  formData.get('limit'),
    status: formData.get('status') || undefined,
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const { page, limit, status } = parsed.data;
  const offset = page * limit;

  try {
    const whereClause = status
      ? and(eq(csvImports.orgId, ctx.orgId), eq(csvImports.status, status))
      : eq(csvImports.orgId, ctx.orgId);

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: csvImports.id,
          importType: csvImports.importType,
          originalFilename: csvImports.originalFilename,
          period: csvImports.period,
          status: csvImports.status,
          rowCount: csvImports.rowCount,
          failedCount: csvImports.failedCount,
          committedAt: csvImports.committedAt,
          createdAt: csvImports.createdAt,
          createdBy: csvImports.createdBy,
        })
        .from(csvImports)
        .where(whereClause)
        .orderBy(desc(csvImports.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: drizzleCount() })
        .from(csvImports)
        .where(whereClause),
    ]);

    const items: ImportLogEntry[] = rows.map(row => ({
      id:               row.id,
      importType:       row.importType,
      originalFilename: row.originalFilename,
      period:           row.period,
      status:           row.status,
      rowCount:         row.rowCount,
      failedCount:      row.failedCount,
      committedAt:      row.committedAt?.toISOString() ?? null,
      createdAt:        row.createdAt.toISOString(),
      createdBy:        row.createdBy,
    }));

    return ok<ImportLogsPage>({
      items,
      total: countRows[0]?.count ?? 0,
      page,
      limit,
    });
  } catch (e) {
    console.error('[getImportLogs] query error:', e instanceof Error ? e.message : String(e));
    return Errors.INTERNAL();
  }
}
