/**
 * GET /api/admin/imports/[importId]
 * Returns full details of a single import log including errors and warnings.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, profiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { importId } = await params;

  // Drizzle query — AC1, AC8: org scoped
  const rows = await db
    .select({
      id:                  importLogs.id,
      importType:          importLogs.importType,
      fileName:            importLogs.fileName,
      role:                importLogs.role,
      status:              importLogs.status,
      rowsReceived:        importLogs.rowsReceived,
      rowsCreated:         importLogs.rowsCreated,
      rowsUpdated:         importLogs.rowsUpdated,
      rowsSkipped:         importLogs.rowsSkipped,
      rowsFailed:          importLogs.rowsFailed,
      validationWarnings:  importLogs.validationWarnings,
      errorDetails:        importLogs.errorDetails,
      airtableSyncResult:  importLogs.airtableSyncResult,
      createdAt:           importLogs.createdAt,
      completedAt:         importLogs.completedAt,
      importedBy:          importLogs.importedBy,
      importedByName:      profiles.fullName,
    })
    .from(importLogs)
    .leftJoin(profiles, eq(importLogs.importedBy, profiles.id))
    .where(and(eq(importLogs.id, importId), eq(importLogs.orgId, ctx.orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import log not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    id:                   row.id,
    import_type:          row.importType,
    file_name:            row.fileName,
    role:                 row.role,
    status:               row.status,
    rows_received:        row.rowsReceived,
    rows_created:         row.rowsCreated,
    rows_updated:         row.rowsUpdated,
    rows_skipped:         row.rowsSkipped,
    rows_failed:          row.rowsFailed,
    validation_warnings:  row.validationWarnings,
    error_details:        row.errorDetails,
    airtable_sync_result: row.airtableSyncResult,
    created_at:           row.createdAt,
    completed_at:         row.completedAt,
    imported_by:          row.importedBy,
    imported_by_name:     row.importedByName ?? null,
  });
}
