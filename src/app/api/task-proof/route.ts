/**
 * GET /api/task-proof?path=...
 * Returns a presigned URL for a task proof image (TTL 3600s).
 * Admin only (tenants cannot access proof images directly).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getSignedUrl } from '@/lib/storage';
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

  try {
    const signedUrl = await getSignedUrl('task-proofs', path, 3600);
    return NextResponse.json({ signedUrl });
  } catch (err) {
    log.error('[task-proof] signed URL failed', { code: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }
}
