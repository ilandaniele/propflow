/**
 * Storage abstraction layer for Supabase Storage.
 *
 * Thin TypeScript module exposing:
 *   uploadImage()       — upload a buffer to a private bucket
 *   getSignedUrl()      — generate a time-limited signed URL
 *   deleteImage()       — remove an object from storage
 *   validateImageFile() — check MIME + magic bytes + size before upload
 *   buildStoragePath()  — canonical path helper: {orgId}/{resourceId}/{uuid}.{ext}
 *
 * Security controls applied here:
 *   - ASVS V12.1.1  MIME allowlist enforced
 *   - ASVS V12.1.2  magic-byte sniff via sniffMimeType()
 *   - ASVS V12.1.3  size cap server-side (never trust client Content-Length)
 *   - ASVS V12.2.1  original filename is metadata only — storage path is uuid-based
 *   - ASVS V12.3.1  path traversal: path built from server-controlled template
 *   - ASVS V12.6.1  SVG rejected (not in ALLOWED_MIME_TYPES)
 *
 * IC-6: Single-backend implementation (Supabase Storage only — YAGNI for
 * single-cloud). The interface is a stable seam; replacing the backend
 * (S3, GCS) would only require changes inside this file.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sniffMimeType } from '@/lib/storage/mime-sniff';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for image uploads — SVG intentionally excluded (ASVS V12.6.1) */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Default signed URL TTL in seconds (1 hour) */
export const DEFAULT_SIGNED_URL_TTL_S = 3600;

/** Maximum image size in bytes (5 MB) — matches bucket policy */
export const MAX_IMAGE_SIZE_BYTES = 5_242_880;

/** Maximum images per unit (IC-11 quota) */
export const MAX_IMAGES_PER_UNIT = 20;

// ---------------------------------------------------------------------------
// Path builder
// ---------------------------------------------------------------------------

/**
 * Builds the canonical storage path for an uploaded image.
 *
 * Format: {orgId}/{resourceId}/{uuid}.{ext}
 *
 * The uuid is generated server-side — the original filename is NEVER used
 * as a path segment (ASVS V12.2.1 + V12.3.1 path-traversal defense).
 *
 * @param orgId      Organization UUID
 * @param resourceId Resource UUID (e.g. unit_id, tenant_id)
 * @param mimeType   Validated MIME type (determines extension)
 * @returns          Storage path string
 */
export function buildStoragePath(
  orgId: string,
  resourceId: string,
  mimeType: AllowedMimeType
): string {
  const ext = mimeTypeToExt(mimeType);
  const uuid = randomUUID();
  return `${orgId}/${resourceId}/${uuid}.${ext}`;
}

/** Maps allowed MIME types to file extensions */
function mimeTypeToExt(mimeType: AllowedMimeType): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sniffedMime?: string | null;
}

/**
 * Validates an image file buffer before upload.
 *
 * Checks:
 *   1. Declared MIME type is in the allowlist
 *   2. File size is within the limit
 *   3. Magic bytes match the declared MIME type (IC-12 anti-spoofing)
 *
 * @param buffer        Raw file bytes
 * @param declaredMime  MIME type declared by the client
 * @param maxBytes      Max allowed size in bytes (default: MAX_IMAGE_SIZE_BYTES = 5 MB)
 * @returns             Validation result with error message if invalid
 */
export function validateImageFile(
  buffer: Buffer,
  declaredMime: string,
  maxBytes: number = MAX_IMAGE_SIZE_BYTES
): ValidationResult {
  // 1. Allowlist check
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    return {
      valid: false,
      error: `MIME type "${declaredMime}" is not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }

  // 2. Size check (server-side — ASVS V12.1.3)
  if (buffer.byteLength > maxBytes) {
    return {
      valid: false,
      error: `File size ${buffer.byteLength} bytes exceeds maximum of ${maxBytes} bytes`,
    };
  }

  // 3. Magic-byte sniff (ASVS V12.1.2 + IC-12)
  const sniffedMime = sniffMimeType(buffer);
  if (sniffedMime === null) {
    return {
      valid: false,
      error: 'Could not determine file type from content (unknown magic bytes)',
      sniffedMime: null,
    };
  }

  if (sniffedMime !== declaredMime) {
    return {
      valid: false,
      error: `Declared MIME type "${declaredMime}" does not match file content (detected: "${sniffedMime}")`,
      sniffedMime,
    };
  }

  return { valid: true, sniffedMime };
}

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

/**
 * Uploads an image buffer to a Supabase Storage bucket.
 *
 * Uses the admin client (service-role) so upload succeeds regardless of the
 * caller's RLS scope. The calling Server Action is responsible for auth checks
 * (requireAdmin / requireTenant) BEFORE calling this function.
 *
 * @param bucket    Target bucket name (e.g. 'unit-images', 'tenant-avatars')
 * @param path      Storage path (e.g. '{orgId}/{unitId}/{uuid}.jpg')
 * @param buffer    File content as Buffer
 * @param mimeType  Validated MIME type for the Content-Type header
 * @returns         Object with { path } on success — throws on failure
 */
export async function uploadImage(
  bucket: string,
  path: string,
  buffer: Buffer,
  mimeType: AllowedMimeType
): Promise<{ path: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`[storage.uploadImage] bucket=${bucket} path=${path} error=${error.message}`);
  }

  return { path };
}

/**
 * Generates a signed URL for a private storage object.
 *
 * The caller is responsible for IDOR checks (path.startsWith(ctx.orgId)) before
 * calling this function. This function only generates the URL — it does not enforce
 * access control.
 *
 * @param bucket  Bucket name
 * @param path    Object path within the bucket
 * @param ttl     Signed URL TTL in seconds (default: DEFAULT_SIGNED_URL_TTL_S = 3600)
 * @returns       Signed URL string — throws on failure
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  ttl: number = DEFAULT_SIGNED_URL_TTL_S
): Promise<string> {
  // Use the user-scoped client for signed URL generation — RLS applies
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(`[storage.getSignedUrl] bucket=${bucket} path=${path} error=${error?.message ?? 'no signed URL returned'}`);
  }

  return data.signedUrl;
}

/**
 * Deletes an object from a Supabase Storage bucket.
 *
 * Uses the admin client (service-role) so deletion succeeds even if the
 * object was uploaded by a different user. The calling Server Action is
 * responsible for verifying ownership before calling this function.
 *
 * @param bucket  Bucket name
 * @param path    Object path to delete
 * @throws        Error if deletion fails
 */
export async function deleteImage(
  bucket: string,
  path: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);

  if (error) {
    throw new Error(`[storage.deleteImage] bucket=${bucket} path=${path} error=${error.message}`);
  }
}
