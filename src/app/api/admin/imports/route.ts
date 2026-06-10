/**
 * GET /api/admin/imports
 * Returns paginated import logs for the admin's org.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

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

  const admin = createAdminClient();

  let query = admin
    .from('import_logs')
    .select(
      'id, import_type, file_name, role, status, rows_received, rows_created, rows_updated, rows_skipped, rows_failed, created_at, completed_at, imported_by, profiles!imported_by(full_name)',
      { count: 'exact' }
    )
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (import_type) query = query.eq('import_type', import_type);
  if (status)      query = query.eq('status', status);

  const { data: logs, count, error } = await query;

  if (error) {
    console.error('[api/admin/imports GET]', error.code);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch import logs.' } }, { status: 500 });
  }

  const rows = (logs ?? []).map((log: Record<string, unknown>) => {
    const profile = log.profiles as Record<string, unknown> | null;
    return {
      id: log.id,
      import_type: log.import_type,
      file_name: log.file_name,
      role: log.role,
      status: log.status,
      rows_received: log.rows_received,
      rows_created: log.rows_created,
      rows_updated: log.rows_updated,
      rows_skipped: log.rows_skipped,
      rows_failed: log.rows_failed,
      created_at: log.created_at,
      completed_at: log.completed_at,
      imported_by_name: profile?.full_name ?? null,
    };
  });

  return NextResponse.json({ logs: rows, total: count ?? 0, page });
}
