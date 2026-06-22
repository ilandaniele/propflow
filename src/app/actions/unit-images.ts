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
import { db } from '@/lib/db';
import { unitImages, units, tenants } from '@/lib/db/schema';
import { eq, and, asc, desc, count as drizzleCount } from 'drizzle-orm';
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

  // 5. IDOR: verify unit belongs to admin's org
  const unitRows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId)))
    .limit(1);

  if (!unitRows[0]) return Errors.NOT_FOUND();

  // 6. Validate file buffer (MIME allowlist + magic bytes + size)
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateImageFile(buffer, file.type);
  if (!validation.valid) {
    if (validation.error?.includes('exceeds maximum')) {
      return Errors.IMAGE_TOO_LARGE();
    }
    return Errors.IMAGE_INVALID_MIME();
  }

  // 7. Check per-unit image quota (20 images max)
  let currentCount = 0;
  try {
    const countRows = await db
      .select({ count: drizzleCount() })
      .from(unitImages)
      .where(and(eq(unitImages.unitId, parsed.data.unit_id), eq(unitImages.orgId, ctx.orgId)));
    currentCount = countRows[0]?.count ?? 0;
  } catch (e) {
    log.error('[uploadUnitImage] quota check error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  if (currentCount >= MAX_IMAGES_PER_UNIT) {
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

  // 10. If is_cover=true, unset previous cover
  if (parsed.data.is_cover) {
    try {
      await db
        .update(unitImages)
        .set({ isCover: false })
        .where(and(
          eq(unitImages.unitId, parsed.data.unit_id),
          eq(unitImages.orgId, ctx.orgId),
          eq(unitImages.isCover, true),
        ));
    } catch (e) {
      log.error('[uploadUnitImage] unset previous cover error', { code: e instanceof Error ? e.message : String(e) });
      await deleteImage(BUCKET, storagePath).catch(() => undefined);
      return Errors.INTERNAL();
    }
  }

  // 11. Insert unit_images row
  let newImageId: string;
  try {
    const rows = await db
      .insert(unitImages)
      .values({
        orgId:       ctx.orgId,
        unitId:      parsed.data.unit_id,
        storagePath,
        filename:    file.name.slice(0, 255),
        mimeType,
        sizeBytes:   file.size,
        width:       parsed.data.width ?? null,
        height:      parsed.data.height ?? null,
        isCover:     parsed.data.is_cover ?? false,
        caption:     parsed.data.caption ?? null,
        sortOrder:   currentCount,
        uploadedBy:  ctx.userId,
      })
      .returning({ id: unitImages.id });

    if (!rows[0]) throw new Error('No row returned');
    newImageId = rows[0].id;
  } catch (e) {
    log.error('[uploadUnitImage] db insert error', { code: e instanceof Error ? e.message : String(e) });
    await deleteImage(BUCKET, storagePath).catch(() => undefined);
    return Errors.INTERNAL();
  }

  // 12. Generate signed URL for the newly uploaded image
  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl(BUCKET, storagePath);
  } catch {
    signedUrl = '';
  }

  // 13. Audit log + cache invalidation
  log.adminAction(ctx.userId, 'unit_image.upload', 'unit_image', newImageId);
  revalidatePath(`/dashboard/units/${parsed.data.unit_id}`);

  return ok({ id: newImageId, signed_url: signedUrl });
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

  // IDOR: fetch the row and verify it belongs to admin's org
  const imageRows = await db
    .select({ id: unitImages.id, unitId: unitImages.unitId, storagePath: unitImages.storagePath, isCover: unitImages.isCover })
    .from(unitImages)
    .where(and(eq(unitImages.id, imageId), eq(unitImages.orgId, ctx.orgId)))
    .limit(1);

  if (!imageRows[0]) return Errors.NOT_FOUND();
  const image = imageRows[0];

  // Spec: cannot delete cover image if other images exist
  if (image.isCover) {
    const countRows = await db
      .select({ count: drizzleCount() })
      .from(unitImages)
      .where(and(eq(unitImages.unitId, image.unitId), eq(unitImages.orgId, ctx.orgId)));

    if ((countRows[0]?.count ?? 0) > 1) {
      return Errors.IMAGE_COVER_CONFLICT();
    }
  }

  // Delete from storage first, then from DB
  try {
    await deleteImage(BUCKET, image.storagePath);
  } catch (storageErr) {
    log.error('[deleteUnitImage] storage delete failed', { error: String(storageErr) });
    return Errors.INTERNAL();
  }

  try {
    await db
      .delete(unitImages)
      .where(and(eq(unitImages.id, imageId), eq(unitImages.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[deleteUnitImage] db delete error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.delete', 'unit_image', imageId);
  revalidatePath(`/dashboard/units/${image.unitId}`);

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

  // IDOR: verify the image belongs to admin's org
  const imageRows = await db
    .select({ id: unitImages.id, unitId: unitImages.unitId })
    .from(unitImages)
    .where(and(eq(unitImages.id, imageId), eq(unitImages.orgId, ctx.orgId)))
    .limit(1);

  if (!imageRows[0]) return Errors.NOT_FOUND();
  const image = imageRows[0];

  // Atomic cover toggle: unset previous cover, then set new cover
  try {
    await db
      .update(unitImages)
      .set({ isCover: false })
      .where(and(
        eq(unitImages.unitId, image.unitId),
        eq(unitImages.orgId, ctx.orgId),
        eq(unitImages.isCover, true),
      ));

    await db
      .update(unitImages)
      .set({ isCover: true })
      .where(and(eq(unitImages.id, imageId), eq(unitImages.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[setUnitCoverImage] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.set_cover', 'unit_image', imageId);
  revalidatePath(`/dashboard/units/${image.unitId}`);

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

  // IDOR: verify the unit belongs to admin's org
  const unitRows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, parsed.data.unit_id), eq(units.orgId, ctx.orgId)))
    .limit(1);

  if (!unitRows[0]) return Errors.NOT_FOUND();

  // Update sort_order for each image. N <= 20 so O(N) updates are trivial.
  const updates = parsed.data.order.map((id, index) =>
    db
      .update(unitImages)
      .set({ sortOrder: index })
      .where(and(
        eq(unitImages.id, id),
        eq(unitImages.unitId, parsed.data.unit_id),
        eq(unitImages.orgId, ctx.orgId),
      ))
      .catch((e: Error) => e)
  );

  const results = await Promise.all(updates);
  const firstError = results.find((r): r is Error => r instanceof Error);
  if (firstError) {
    log.error('[reorderUnitImages] db update error', { code: firstError.message });
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

  // IDOR: verify image belongs to admin's org
  const imageRows = await db
    .select({ id: unitImages.id, unitId: unitImages.unitId })
    .from(unitImages)
    .where(and(eq(unitImages.id, parsed.data.id), eq(unitImages.orgId, ctx.orgId)))
    .limit(1);

  if (!imageRows[0]) return Errors.NOT_FOUND();
  const image = imageRows[0];

  try {
    await db
      .update(unitImages)
      .set({ caption: parsed.data.caption })
      .where(and(eq(unitImages.id, parsed.data.id), eq(unitImages.orgId, ctx.orgId)));
  } catch (e) {
    log.error('[updateUnitImageCaption] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  log.adminAction(ctx.userId, 'unit_image.update_caption', 'unit_image', parsed.data.id);
  revalidatePath(`/dashboard/units/${image.unitId}`);

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

  // IDOR: verify unit belongs to admin's org
  const unitRows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, ctx.orgId)))
    .limit(1);

  if (!unitRows[0]) return Errors.NOT_FOUND();

  let rows: Array<{
    id: string; unitId: string; storagePath: string; filename: string; mimeType: string;
    sizeBytes: number; width: number | null; height: number | null; isCover: boolean;
    caption: string | null; sortOrder: number; uploadedBy: string | null; createdAt: Date;
  }>;

  try {
    rows = await db
      .select({
        id:          unitImages.id,
        unitId:      unitImages.unitId,
        storagePath: unitImages.storagePath,
        filename:    unitImages.filename,
        mimeType:    unitImages.mimeType,
        sizeBytes:   unitImages.sizeBytes,
        width:       unitImages.width,
        height:      unitImages.height,
        isCover:     unitImages.isCover,
        caption:     unitImages.caption,
        sortOrder:   unitImages.sortOrder,
        uploadedBy:  unitImages.uploadedBy,
        createdAt:   unitImages.createdAt,
      })
      .from(unitImages)
      .where(and(eq(unitImages.unitId, unitId), eq(unitImages.orgId, ctx.orgId)))
      .orderBy(asc(unitImages.sortOrder), desc(unitImages.isCover));
  } catch (e) {
    log.error('[getUnitImagesAdmin] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  const images: NormalizedImage[] = await Promise.all(
    rows.map(async (row) => {
      let url = '';
      try {
        url = await getSignedUrl(BUCKET, row.storagePath);
      } catch {
        url = '';
      }

      return NormalizedImageSchema.parse({
        id:        row.id,
        url,
        filename:  row.filename,
        mimeType:  row.mimeType,
        sizeBytes: row.sizeBytes,
        width:     row.width ?? undefined,
        height:    row.height ?? undefined,
        isCover:   row.isCover,
        caption:   row.caption,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
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

  // Look up the tenant's assigned unit from the tenants table
  const tenantRows = await db
    .select({ unitId: tenants.unitId })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const assignedUnitId = tenantRows[0]?.unitId ?? null;
  if (!assignedUnitId) {
    // Tenant has no assigned unit — return empty list
    return ok([]);
  }

  let rows: Array<{
    id: string; storagePath: string; filename: string; mimeType: string;
    sizeBytes: number; width: number | null; height: number | null; isCover: boolean;
    caption: string | null; sortOrder: number; createdAt: Date;
  }>;

  try {
    rows = await db
      .select({
        id:          unitImages.id,
        storagePath: unitImages.storagePath,
        filename:    unitImages.filename,
        mimeType:    unitImages.mimeType,
        sizeBytes:   unitImages.sizeBytes,
        width:       unitImages.width,
        height:      unitImages.height,
        isCover:     unitImages.isCover,
        caption:     unitImages.caption,
        sortOrder:   unitImages.sortOrder,
        createdAt:   unitImages.createdAt,
      })
      .from(unitImages)
      .where(and(eq(unitImages.unitId, assignedUnitId), eq(unitImages.orgId, ctx.orgId)))
      .orderBy(asc(unitImages.sortOrder), desc(unitImages.isCover));
  } catch (e) {
    log.error('[getUnitImagesTenant] db error', { code: e instanceof Error ? e.message : String(e) });
    return Errors.INTERNAL();
  }

  const images: NormalizedImage[] = await Promise.all(
    rows.map(async (row) => {
      let url = '';
      try {
        url = await getSignedUrl(BUCKET, row.storagePath);
      } catch {
        url = '';
      }

      return NormalizedImageSchema.parse({
        id:        row.id,
        url,
        filename:  row.filename,
        mimeType:  row.mimeType,
        sizeBytes: row.sizeBytes,
        width:     row.width ?? undefined,
        height:    row.height ?? undefined,
        isCover:   row.isCover,
        caption:   row.caption,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
      });
    })
  );

  return ok(images);
}
