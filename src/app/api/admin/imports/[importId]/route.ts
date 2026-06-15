/**
 * GET /api/admin/imports/[importId]
 * Returns full details of a single import log including errors and warnings.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, profiles } from '@/lib/db/schema';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { importId } = await params;

  const rows = await db.select({
    id:                 importLogs.id,
    importType:         importLogs.importType,
    fileName:           importLogs.fileName,
    role:               importLogs.role,
    status:             importLogs.status,
    rowsReceived:       importLogs.rowsReceived,
    rowsCreated:        importLogs.rowsCreated,
    rowsUpdated:        importLogs.rowsUpdated,
    rowsSkipped:        importLogs.rowsSkipped,
    rowsFailed:         importLogs.rowsFailed,
    validationWarnings: importLogs.validationWarnings,
    errorDetails:       importLogs.errorDetails,
    airtableSyncResult: importLogs.airtableSyncResult,
    createdAt:          importLogs.createdAt,
    completedAt:        importLogs.completedAt,
    importedBy:         importLogs.importedBy,
    importedByName:     profiles.fullName,
  })
    .from(importLogs)
    .leftJoin(profiles, eq(profiles.id, importLogs.importedBy))
    .where(and(eq(importLogs.id, importId), eq(importLogs.orgId, ctx.orgId)));

  const log = rows[0] ?? null;
  if (!log) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import log not found.' } }, { status: 404 });
  }

  return NextResponse.json(log);
}
