/**
 * GET /api/admin/imports
 * Returns paginated import logs for the admin's org.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, count as sqlCount, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { importLogs, profiles } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth/guards';

const QuerySchema = z.object({
  import_type: z.string().optional(),
  status:      z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const { import_type, status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const baseConditions = [eq(importLogs.orgId, ctx.orgId)];
  if (import_type) baseConditions.push(eq(importLogs.importType, import_type));
  if (status)      baseConditions.push(eq(importLogs.status, status));

  const whereClause = and(...baseConditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id:           importLogs.id,
        importType:   importLogs.importType,
        fileName:     importLogs.fileName,
        role:         importLogs.role,
        status:       importLogs.status,
        rowsReceived: importLogs.rowsReceived,
        rowsCreated:  importLogs.rowsCreated,
        rowsUpdated:  importLogs.rowsUpdated,
        rowsSkipped:  importLogs.rowsSkipped,
        rowsFailed:   importLogs.rowsFailed,
        createdAt:    importLogs.createdAt,
        completedAt:  importLogs.completedAt,
        importedBy:   importLogs.importedBy,
        importedByName: profiles.fullName,
      })
      .from(importLogs)
      .leftJoin(profiles, eq(importLogs.importedBy, profiles.id))
      .where(whereClause)
      .orderBy(desc(importLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: sqlCount() }).from(importLogs).where(whereClause),
  ]);

  const total = Number(countRows[0]?.value ?? 0);

  const logs = rows.map(row => ({
    id:               row.id,
    import_type:      row.importType,
    file_name:        row.fileName,
    role:             row.role,
    status:           row.status,
    rows_received:    row.rowsReceived,
    rows_created:     row.rowsCreated,
    rows_updated:     row.rowsUpdated,
    rows_skipped:     row.rowsSkipped,
    rows_failed:      row.rowsFailed,
    created_at:       row.createdAt,
    completed_at:     row.completedAt,
    imported_by_name: row.importedByName ?? null,
  }));

  return NextResponse.json({ logs, total, page });
}
