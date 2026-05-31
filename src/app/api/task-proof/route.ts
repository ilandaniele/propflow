/**
 * GET /api/task-proof?path=...
 * Returns a signed URL for a task proof image (TTL 3600s).
 * Admin only (tenants cannot access proof images directly).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  const path = request.nextUrl.searchParams.get('path');
  if (!path || !path.startsWith(ctx.orgId)) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('task-proofs')
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    log.error('[task-proof] signed URL failed', { code: error?.message });
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
