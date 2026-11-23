/**
 * GET /api/org-branding  — branding of the caller's org (any signed-in user)
 * PUT /api/org-branding  — admin saves accent color and/or logo (multipart)
 *
 * PUT is not sendable by an HTML form and needs a CORS preflight cross-origin,
 * so the SameSite session cookie is enough against CSRF.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { log } from '@/lib/log';
import { mutationRateLimit } from '@/lib/ratelimit';
import { buildStoragePath, deleteImage, uploadImage } from '@/lib/storage/index';
import { isSafeOrgScopedPath } from '@/lib/storage/path';
import { getOrgBranding, getOrgBrandingRow, saveOrgBranding, toBrandingDto } from '@/lib/branding/org-branding';
import { checkLogoFile, LOGO_BUCKET, MAX_LOGO_BYTES, SaveBrandingSchema } from '@/lib/branding/validation';

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }
  return NextResponse.json(await getOrgBranding(ctx.orgId));
}

async function uploadLogo(orgId: string, file: File): Promise<NextResponse | string> {
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json(Errors.IMAGE_TOO_LARGE(), { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const check = checkLogoFile(buffer, file.type);
  if (!check.ok) {
    return NextResponse.json(Errors[check.code](), { status: check.code === 'IMAGE_TOO_LARGE' ? 413 : 400 });
  }
  const path = buildStoragePath(orgId, 'branding', check.mime);
  try {
    await uploadImage(LOGO_BUCKET, path, buffer, check.mime);
  } catch (error) {
    log.error('[org-branding] logo upload failed', { error: String(error).slice(0, 200) });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }
  return path;
}

async function deleteOldLogo(orgId: string, oldKey: string | null | undefined, newKey: string | null): Promise<void> {
  if (!oldKey || oldKey === newKey || !isSafeOrgScopedPath(oldKey, orgId)) return;
  try {
    await deleteImage(LOGO_BUCKET, oldKey);
  } catch (error) {
    log.warn('[org-branding] old logo cleanup failed', { error: String(error).slice(0, 200) });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json(Errors.FORBIDDEN(), { status: 403 });
    }
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  if (!mutationRateLimit(ctx.userId, 'org-branding').success) {
    return NextResponse.json(Errors.RATE_LIMITED(), { status: 429 });
  }

  let form: FormData;
  try { form = await request.formData(); } catch {
    return NextResponse.json(Errors.VALIDATION_ERROR({ formErrors: ['Expected multipart form data'], fieldErrors: {} }), { status: 400 });
  }

  const parsed = SaveBrandingSchema.safeParse({
    accent_color: form.get('accent_color'),
    remove_logo: form.get('remove_logo'),
  });
  if (!parsed.success) return NextResponse.json(Errors.VALIDATION_ERROR(parsed.error.flatten()), { status: 400 });

  const current = await getOrgBrandingRow(ctx.orgId);
  let logoKey = parsed.data.remove_logo ? null : current?.logoKey ?? null;

  const file = form.get('logo');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadLogo(ctx.orgId, file);
    if (uploaded instanceof NextResponse) return uploaded;
    logoKey = uploaded;
  }

  const saved = await saveOrgBranding(ctx.orgId, { logoKey, accentColor: parsed.data.accent_color });
  await deleteOldLogo(ctx.orgId, current?.logoKey, logoKey);
  log.adminAction(ctx.userId, 'org_branding.update', 'org_branding', ctx.orgId);

  return NextResponse.json(toBrandingDto(saved));
}
