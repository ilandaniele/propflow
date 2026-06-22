/**
 * GET /api/tenant-avatar?path=...
 * Returns a signed URL for a tenant avatar image (TTL 3600s).
 * Admin or owning tenant only.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guards';
import { getSignedUrl } from '@/lib/storage/index';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  const path = request.nextUrl.searchParams.get('path');
  if (!path || !path.startsWith(ctx.orgId)) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Generate signed URL via Tigris storage lib (AC1: no supabase.storage calls)
  try {
    const signedUrl = await getSignedUrl('tenant-avatars', path, 3600);
    return NextResponse.json({ signedUrl });
  } catch (err) {
    log.error('[tenant-avatar] signed URL failed', { error: String(err).slice(0, 100) });
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }
}
