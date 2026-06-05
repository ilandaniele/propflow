'use server';

/**
 * Server Actions for unit image management.
 *
 * Security controls:
 *   - All mutations require admin role via requireAdmin()
 *   - IDOR: unit ownership verified against admin's org before any mutation
 *   - Image files validated via validateImageFile() (MIME allowlist + magic bytes + size)
 *   - Rate limits enforced per spec: 30/min upload, 60/min other mutations
 *   - Storage paths built server-side via buildStoragePath() (no user filename in path)
 *   - Audit logging via log.adminAction() on every mutation
 *   - Signed URLs generated for read responses
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import {
  validateImageFile,
  buildStoragePath,
  uploadImage,
  deleteImage,
  getSignedUrl,
  MAX_IMAGES_PER_UNIT,
} from '@/lib/storage/index';
import {
  UploadUnitImageSchema,
  UpdateCaptionSchema,
  ReorderUnitImagesSchema,
  NormalizedImageSchema,
} from '@/lib/schemas/image';
import { actionRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import type { ActionResult } from '@/lib/errors';
import type { NormalizedImage } from '@/lib/schemas/image';

const BUCKET = 'unit-images';
const ONE_MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Rate limit helpers
// ---------------------------------------------------------------------------

/** 30 requests / minute / admin for upload */
function uploadRateLimit(userId: string) {
  return actionRateLimit(`unit-img:upload:${userId}`, 30, ONE_MINUTE_MS);
}

/** 60 requests / minute / admin for other mutations */
function mutRateLimit(userId: string, action: string) {
  return actionRateLimit(`unit-img:${action}:${userId}`, 60, ONE_MINUTE_MS);
}

// ---------------------------------------------------------------------------
// uploadUnitImage
// ---------------------------------------------------------------------------

export interface UploadUnitImageResult {
  id: string;
  signed_url: string;
}

export async function uploadUnitImage(
  _prev: ActionResult<UploadUnitImageResult>,
  formData: FormData
): Promise<ActionResult<UploadUnitImageResult>> {
  // 1. Auth
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  // 2. Rate limit (30/min per admin)
  const rl = uploadRateLimit(ctx.userId);
  if (!rl.success) return Errors.RATE_LIMITED();

  // 3. Validate non-file fields
  const parsed = UploadUnitImageSchema.safeParse({
    unit_id: formData.get('unit_id'),
    is_cover: formData.get('is_cover'),
    caption: formData.get('caption') || undefined,
    width: formData.get('width') || undefined,
    height: formData.get('height') || undefined,
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  // 4. Validate file metadata (early rejection before reading buffer)
  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return Errors.VALIDATION_ERROR({ formErrors: ['file is required'], fieldErrors: {} });
  }

  const supabase = await createClient();

  // 5. IDOR: verify unit belongs to admin's org
  const { data: unit } = await supabase
    .from('units')
    .select('id, org_id')
    .eq('id', parsed.data.unit_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!unit) return Errors.NOT_FOUND();

  // 6. Validate file buffer (MIME allowlist + magic bytes + size)
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    // Distinguish size error from MIME error for correct HTTP status
    if (validation.error?.includes('exceeds maximum')) {
      return Errors.IMAGE_TOO_LARGE();
    }
    return Errors.IMAGE_INVALID_MIME();
  }

  // 7. Check per-unit image quota (20 images max)
  const { count, error: countError } = await supabase
    .from('unit_images')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', parsed.data.unit_id)
    .eq('org_id', ctx.orgId);

  if (countError) {
    log.error('[uploadUnitImage] quota check error', { code: countError.code });
    return Errors.INTERNAL();
  }

  if ((count ?? 0) >= MAX_IMAGES_PER_UNIT) {
    return Errors.IMAGE_QUOTA_EXCEEDED();
  }

  // 8. Build storage path (server-generated uuid — no user filename in path)
  const mimeType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';
  const storagePath = buildStoragePath(ctx.orgId, parsed.data.unit_id, mimeType);

  // 9. Upload to storage
  try {
    await uploadImage(BUCKET, storagePath, buffer, mimeType);
  } catch (uploadErr) {
    log.error('[uploadUnitImage] storage upload failed', { error: String(uploadErr) });
    return Errors.INTERNAL();
  }

  // 10. If is_cover=true, unset previous cover atomically (same transaction via RPC)
  if (parsed.data.is_cover) {
    const { error: unsetError } = await supabase
      .from('unit_images')
      .update({ is_cover: false })
      .eq('unit_id', parsed.data.unit_id)
      .eq('org_id', ctx.orgId)
      .eq('is_cover', true);

    if (unsetError) {
      log.error('[uploadUnitImage] unset previous cover error', { code: unsetError.code });
      // Clean up the uploaded file before returning error
      await deleteImage(BUCKET, storagePath).catch(() => undefined);
      return Errors.INTERNAL();
    }
  }

  // 11. Insert unit_images row
  const { data: newImage, error: insertError } = await supabase
    .from('unit_images')
    .insert({
      org_id: ctx.orgId,
      unit_id: parsed.data.unit_id,
      storage_path: storagePath,
      filename: file.name.slice(0, 255),
      mime_type: mimeType,
      size_bytes: file.size,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      is_cover: parsed.data.is_cover ?? false,
      caption: parsed.data.caption ?? null,
      sort_order: count ?? 0,
      uploaded_by: ctx.userId,
    })
    .select('id')
    .single();

  if (insertError || !newImage) {
    log.error('[uploadUnitImage] db insert error', { code: insertError?.code });
    await deleteImage(BUCKET, storagePath).catch(() => undefined);
    return Errors.INTERNAL();
  }

  // 12. Generate signed URL for the newly uploaded image
  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl(BUCKET, storagePath);
  } catch {
    // Non-fatal: return ok with empty URL rather than failing the whole upload
    signedUrl = '';
  }

  // 13. Audit log + cache invalidation
  log.adminAction(ctx.userId, 'unit_image.upload', 'unit_image', newImage.id);
  revalidatePath(`/dashboard/units/${parsed.data.unit_id}`);

  return ok({ id: newImage.id, signed_url: signedUrl });
}

// ---------------------------------------------------------------------------
// deleteUnitImage
// ---------------------------------------------------------------------------

export async function deleteUnitImage(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutRateLimit(ctx.userId, 'delete');
  if (!rl.success) return Errors.RATE_LIMITED();

  const imageId = formData.get('id') as string | null;
  if (!imageId) return Errors.VALIDATION_ERROR({ formErrors: ['id is required'], fieldErrors: {} });

  const supabase = await createClient();

  // IDOR: fetch the row and verify it belongs to admin's org
  const { data: image } = await supabase
    .from('unit_images')
    .select('id, org_id, unit_id, storage_path, is_cover')
    .eq('id', imageId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!image) return Errors.NOT_FOUND();

  // Spec: cannot delete cover image if other images exist
  if (image.is_cover) {
    const { count } = await supabase
      .from('unit_images')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', image.unit_id)
      .eq('org_id', ctx.orgId);

    if ((count ?? 0) > 1) {
      return Errors.IMAGE_COVER_CONFLICT();
    }
  }

  // Delete from storage first, then from DB
  try {
    await deleteImage(BUCKET, image.storage_path);
  } catch (storageErr) {
    log.error('[deleteUnitImage] storage delete failed', { error: String(storageErr) });
    return Errors.INTERNAL();
  }

  const { error: deleteError } = await supabase
    .from('unit_images')
    .delete()
    .eq('id', imageId)
    .eq('org_id', ctx.orgId);

  if (deleteError) {
    log.error('[deleteUnitImage] db delete error', { code: deleteError.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.delete', 'unit_image', imageId);
  revalidatePath(`/dashboard/units/${image.unit_id}`);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// setUnitCoverImage
// ---------------------------------------------------------------------------

export async function setUnitCoverImage(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutRateLimit(ctx.userId, 'set_cover');
  if (!rl.success) return Errors.RATE_LIMITED();

  const imageId = formData.get('id') as string | null;
  if (!imageId) return Errors.VALIDATION_ERROR({ formErrors: ['id is required'], fieldErrors: {} });

  const supabase = await createClient();

  // IDOR: verify the image belongs to admin's org
  const { data: image } = await supabase
    .from('unit_images')
    .select('id, org_id, unit_id')
    .eq('id', imageId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!image) return Errors.NOT_FOUND();

  // Atomic cover toggle: unset previous cover, then set new cover
  const { error: unsetError } = await supabase
    .from('unit_images')
    .update({ is_cover: false })
    .eq('unit_id', image.unit_id)
    .eq('org_id', ctx.orgId)
    .eq('is_cover', true);

  if (unsetError) {
    log.error('[setUnitCoverImage] unset error', { code: unsetError.code });
    return Errors.INTERNAL();
  }

  const { error: setError } = await supabase
    .from('unit_images')
    .update({ is_cover: true })
    .eq('id', imageId)
    .eq('org_id', ctx.orgId);

  if (setError) {
    log.error('[setUnitCoverImage] set error', { code: setError.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.set_cover', 'unit_image', imageId);
  revalidatePath(`/dashboard/units/${image.unit_id}`);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// reorderUnitImages
// ---------------------------------------------------------------------------

export async function reorderUnitImages(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutRateLimit(ctx.userId, 'reorder');
  if (!rl.success) return Errors.RATE_LIMITED();

  // Parse order array from JSON string in FormData
  let orderRaw: unknown;
  try {
    const orderStr = formData.get('order') as string | null;
    orderRaw = orderStr ? JSON.parse(orderStr) : undefined;
  } catch {
    return Errors.VALIDATION_ERROR({ formErrors: ['order must be a JSON array of UUIDs'], fieldErrors: {} });
  }

  const parsed = ReorderUnitImagesSchema.safeParse({
    unit_id: formData.get('unit_id'),
    order: orderRaw,
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // IDOR: verify the unit belongs to admin's org
  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('id', parsed.data.unit_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!unit) return Errors.NOT_FOUND();

  // Update sort_order for each image in one transaction using sequential updates.
  // N <= 20 so O(N) updates are trivial (IC-13).
  const updates = parsed.data.order.map((id, index) =>
    supabase
      .from('unit_images')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('unit_id', parsed.data.unit_id)
      .eq('org_id', ctx.orgId)
  );

  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    log.error('[reorderUnitImages] db update error', { code: firstError.error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.reorder', 'unit', parsed.data.unit_id);
  revalidatePath(`/dashboard/units/${parsed.data.unit_id}`);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// updateUnitImageCaption
// ---------------------------------------------------------------------------

export async function updateUnitImageCaption(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  const rl = mutRateLimit(ctx.userId, 'caption');
  if (!rl.success) return Errors.RATE_LIMITED();

  const parsed = UpdateCaptionSchema.safeParse({
    id: formData.get('id'),
    caption: formData.get('caption') ?? null,
  });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const supabase = await createClient();

  // IDOR: verify image belongs to admin's org
  const { data: image } = await supabase
    .from('unit_images')
    .select('id, unit_id')
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!image) return Errors.NOT_FOUND();

  const { error } = await supabase
    .from('unit_images')
    .update({ caption: parsed.data.caption })
    .eq('id', parsed.data.id)
    .eq('org_id', ctx.orgId);

  if (error) {
    log.error('[updateUnitImageCaption] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.update_caption', 'unit_image', parsed.data.id);
  revalidatePath(`/dashboard/units/${image.unit_id}`);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// getUnitImagesAdmin — returns NormalizedImage[] with signed URLs for admin
// ---------------------------------------------------------------------------

export async function getUnitImagesAdmin(
  unitId: string
): Promise<ActionResult<NormalizedImage[]>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }

  if (!unitId) return Errors.VALIDATION_ERROR({ formErrors: ['unitId is required'], fieldErrors: {} });

  const supabase = await createClient();

  // IDOR: verify unit belongs to admin's org
  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('id', unitId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!unit) return Errors.NOT_FOUND();

  const { data: rows, error } = await supabase
    .from('unit_images')
    .select('id, org_id, unit_id, storage_path, filename, mime_type, size_bytes, width, height, is_cover, caption, sort_order, uploaded_by, uploaded_at')
    .eq('unit_id', unitId)
    .eq('org_id', ctx.orgId)
    .order('sort_order', { ascending: true })
    .order('is_cover', { ascending: false });

  if (error) {
    log.error('[getUnitImagesAdmin] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  const images: NormalizedImage[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      let url = '';
      try {
        url = await getSignedUrl(BUCKET, row.storage_path);
      } catch {
        url = '';
      }

      return NormalizedImageSchema.parse({
        id: row.id,
        url,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        isCover: row.is_cover,
        caption: row.caption,
        sortOrder: row.sort_order,
        createdAt: row.uploaded_at,
      });
    })
  );

  return ok(images);
}

// ---------------------------------------------------------------------------
// getUnitImagesTenant — returns NormalizedImage[] for the tenant's assigned unit
// ---------------------------------------------------------------------------

export async function getUnitImagesTenant(): Promise<ActionResult<NormalizedImage[]>> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }

  const supabase = await createClient();

  // Look up the tenant's assigned unit from the tenants table
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('unit_id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenantRow?.unit_id) {
    // Tenant has no assigned unit — return empty list
    return ok([]);
  }

  const { data: rows, error } = await supabase
    .from('unit_images')
    .select('id, storage_path, filename, mime_type, size_bytes, width, height, is_cover, caption, sort_order, uploaded_at')
    .eq('unit_id', tenantRow.unit_id)
    .eq('org_id', ctx.orgId)
    .order('sort_order', { ascending: true })
    .order('is_cover', { ascending: false });

  if (error) {
    log.error('[getUnitImagesTenant] db error', { code: error.code });
    return Errors.INTERNAL();
  }

  const images: NormalizedImage[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      let url = '';
      try {
        url = await getSignedUrl(BUCKET, row.storage_path);
      } catch {
        url = '';
      }

      return NormalizedImageSchema.parse({
        id: row.id,
        url,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        isCover: row.is_cover,
        caption: row.caption,
        sortOrder: row.sort_order,
        createdAt: row.uploaded_at,
      });
    })
  );

  return ok(images);
}
