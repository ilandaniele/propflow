/**
 * GET /api/admin/imports/[importId]
 * Returns full details of a single import log including errors and warnings.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ importId: string }> }
): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const { importId } = await params;
  const admin = createAdminClient();

  const { data: log, error } = await admin
    .from('import_logs')
    .select(
      'id, import_type, file_name, role, status, rows_received, rows_created, rows_updated, rows_skipped, rows_failed, validation_warnings, error_details, airtable_sync_result, created_at, completed_at, imported_by, profiles!imported_by(full_name)'
    )
    .eq('id', importId)
    .eq('org_id', ctx.orgId)
    .single();

  if (error || !log) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Import log not found.' } }, { status: 404 });
  }

  const profile = (log as Record<string, unknown>).profiles as Record<string, unknown> | null;
  return NextResponse.json({
    ...(log as Record<string, unknown>),
    profiles: undefined,
    imported_by_name: profile?.full_name ?? null,
  });
}
