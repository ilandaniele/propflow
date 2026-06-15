/**
 * GET /api/admin/imports
 * Returns paginated import logs for the admin's org.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, count as drizzleCount } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, profiles } from '@/lib/db/schema';

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

  try {
    const conditions = [eq(importLogs.orgId, ctx.orgId)];
    if (import_type) conditions.push(eq(importLogs.importType, import_type));
    if (status)      conditions.push(eq(importLogs.status, status));
    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db.select({
        id:            importLogs.id,
        importType:    importLogs.importType,
        fileName:      importLogs.fileName,
        role:          importLogs.role,
        status:        importLogs.status,
        rowsReceived:  importLogs.rowsReceived,
        rowsCreated:   importLogs.rowsCreated,
        rowsUpdated:   importLogs.rowsUpdated,
        rowsSkipped:   importLogs.rowsSkipped,
        rowsFailed:    importLogs.rowsFailed,
        createdAt:     importLogs.createdAt,
        completedAt:   importLogs.completedAt,
        importedBy:    importLogs.importedBy,
        importedByName: profiles.fullName,
      })
        .from(importLogs)
        .leftJoin(profiles, eq(profiles.id, importLogs.importedBy))
        .where(whereClause)
        .orderBy(importLogs.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: drizzleCount() }).from(importLogs).where(whereClause),
    ]);

    return NextResponse.json({ logs: rows, total: Number(countRows[0]?.total ?? 0), page });
  } catch (err) {
    console.error('[api/admin/imports GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch import logs.' } }, { status: 500 });
  }
}
