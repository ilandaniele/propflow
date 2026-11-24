/**
 * GET /api/org-branding/logo — streams the caller's org logo from R2.
 * Same-origin bytes (not a redirect to a presigned URL) so the browser-side
 * PDF renderer can read it without R2 CORS rules.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { ALLOWED_MIME_TYPES, getSignedUrl } from '@/lib/storage/index';
import { isSafeOrgScopedPath } from '@/lib/storage/path';
import { getOrgBrandingRow } from '@/lib/branding/org-branding';
import { LOGO_BUCKET } from '@/lib/branding/validation';

const FETCH_TIMEOUT_MS = 10_000;

function notFound(): NextResponse {
  return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
}

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  const logoKey = (await getOrgBrandingRow(ctx.orgId))?.logoKey;
  if (!isSafeOrgScopedPath(logoKey, ctx.orgId)) return notFound();

  try {
    const object = await fetch(await getSignedUrl(LOGO_BUCKET, logoKey), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const contentType = object.headers.get('content-type') ?? '';
    if (!object.ok || !(ALLOWED_MIME_TYPES as readonly string[]).includes(contentType)) return notFound();
    return new NextResponse(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.error('[org-branding] logo fetch failed', { error: String(error).slice(0, 200) });
    return notFound();
  }
}
