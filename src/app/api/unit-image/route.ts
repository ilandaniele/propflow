/**
 * GET /api/unit-image?path={org_id}/{unit_id}/{file}
 *
 * Returns a signed URL (TTL 3600s) for a private unit image.
 *
 * Auth: supports both admin and tenant sessions (requireUser()).
 * IDOR guards:
 *   - Admin: path must start with admin's org_id
 *   - Tenant: path must start with {orgId}/{tenantUnitId}/ (their assigned unit only)
 *
 * Security controls (spec §Security):
 *   - V12.4.1 storage bucket is PRIVATE — reads only via signed URL
 *   - V12.4.2 IDOR guard: path.startsWith(ctx.orgId) for all callers
 *   - V12.3.1 path traversal: path segments validated (no ../ allowed)
 *   - Path format enforced: {org_id}/{unit_id}/{filename} — exactly 3 segments
 *
 * Response:
 *   200 { url: string, expiresIn: 3600 }
 *   400 if path is missing or malformed
 *   404 if path org_id does not match caller's org (prevents enumeration)
 *   404 if tenant cannot access that unit (not their assigned unit)
 *   500 on signed-URL generation failure (logged, no internals leaked)
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { getSignedUrl } from '@/lib/storage/index';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';

const BUCKET = 'unit-images';
const SIGNED_URL_TTL_S = 3600;

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Auth (admin or tenant)
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  // 2. Extract and validate path parameter
  const path = request.nextUrl.searchParams.get('path');

  if (!path) {
    return NextResponse.json(Errors.VALIDATION_ERROR({ formErrors: ['path is required'], fieldErrors: {} }), { status: 400 });
  }

  // Path traversal guard (ASVS V12.3.1): reject any path containing ..
  if (path.includes('..') || path.includes('\0') || /[<>:"|?*]/.test(path)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PATH', message: 'Invalid path format' } },
      { status: 400 }
    );
  }

  // Enforce exactly 3 segments: {org_id}/{unit_id}/{filename}
  const segments = path.split('/');
  if (segments.length !== 3 || segments.some((s) => !s || s.length === 0)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PATH', message: 'Path must be in the format {org_id}/{unit_id}/{filename}' } },
      { status: 400 }
    );
  }

  const [pathOrgId, pathUnitId] = segments;

  // 3. IDOR guard: path must start with the caller's org_id
  if (pathOrgId !== ctx.orgId) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // 4. Tenant-specific IDOR: must be tenant's assigned unit
  if (ctx.role === 'tenant') {
    const supabase = await createClient();
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('unit_id')
      .eq('profile_id', ctx.userId)
      .eq('org_id', ctx.orgId)
      .single();

    if (!tenantRow?.unit_id || tenantRow.unit_id !== pathUnitId) {
      return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
    }
  }

  // 5. Generate signed URL
  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl(BUCKET, path, SIGNED_URL_TTL_S);
  } catch (err) {
    log.error('[unit-image] signed URL generation failed', { error: String(err).slice(0, 100) });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }

  return NextResponse.json({ url: signedUrl, expiresIn: SIGNED_URL_TTL_S });
}
