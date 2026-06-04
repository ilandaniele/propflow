/**
 * Zod schemas for image upload validation, unit_images row shape, and
 * normalized image output used in Server Actions, Route Handlers, and UI.
 *
 * All upload-boundary schemas enforce:
 *   - MIME type allowlist (image/jpeg, image/png, image/webp only — SVG excluded)
 *   - Size cap (5 MB server-side — ASVS V12.1.3)
 *   - Caption length limit (500 chars)
 *
 * The magic-byte MIME sniff is NOT done in Zod (it requires a Buffer, not
 * a schema field). Call validateImageFile() from src/lib/storage/index.ts
 * separately after these schema checks pass.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants (must stay in sync with src/lib/storage/index.ts)
// ---------------------------------------------------------------------------

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_SIZE_BYTES = 5_242_880; // 5 MB
export const MAX_CAPTION_LENGTH = 500;
export const MAX_IMAGES_PER_UNIT = 20;

// ---------------------------------------------------------------------------
// Base MIME type schema (reused across schemas)
// ---------------------------------------------------------------------------

export const MimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'], {
  errorMap: () => ({
    message: 'File type must be image/jpeg, image/png, or image/webp',
  }),
});

// ---------------------------------------------------------------------------
// ImageFileSchema
// Validates metadata from a FormData File field before reading the buffer.
// Used in Server Actions to reject obviously invalid uploads early.
// ---------------------------------------------------------------------------

export const ImageFileSchema = z.object({
  /** MIME type declared by the client — must be in the allowlist */
  type: MimeTypeSchema,
  /** File size in bytes — must not exceed 5 MB (server-side enforcement) */
  size: z.number().int().positive().max(MAX_IMAGE_SIZE_BYTES, {
    message: `File must be at most ${MAX_IMAGE_SIZE_BYTES} bytes (5 MB)`,
  }),
  /** Original filename — stored as metadata only, NEVER used as storage path */
  name: z.string().min(1).max(255),
});

export type ImageFileMeta = z.infer<typeof ImageFileSchema>;

// ---------------------------------------------------------------------------
// Upload input schema (from FormData)
// Used in uploadUnitImage() Server Action
// ---------------------------------------------------------------------------

export const UploadUnitImageSchema = z.object({
  unit_id: z.string().uuid('unit_id must be a valid UUID'),
  is_cover: z.preprocess(
    (v) => v === 'true' || v === true,
    z.boolean().default(false)
  ),
  caption: z.string().max(MAX_CAPTION_LENGTH).optional().nullable(),
  // width / height are optional best-effort hints from the client (IC-7)
  width: z.preprocess(
    (v) => (v ? Number(v) : undefined),
    z.number().int().positive().optional()
  ),
  height: z.preprocess(
    (v) => (v ? Number(v) : undefined),
    z.number().int().positive().optional()
  ),
});

export type UploadUnitImageInput = z.infer<typeof UploadUnitImageSchema>;

// ---------------------------------------------------------------------------
// Caption update schema
// Used in updateUnitImageCaption() Server Action
// ---------------------------------------------------------------------------

export const UpdateCaptionSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  caption: z
    .string()
    .max(MAX_CAPTION_LENGTH, {
      message: `Caption must be at most ${MAX_CAPTION_LENGTH} characters`,
    })
    // Disallow HTML tags (anti-XSS — caption is stored and later rendered)
    .refine((v) => !/<[^>]+>/.test(v), {
      message: 'Caption must not contain HTML',
    })
    .nullable(),
});

export type UpdateCaptionInput = z.infer<typeof UpdateCaptionSchema>;

// ---------------------------------------------------------------------------
// Reorder schema
// Used in reorderUnitImages() Server Action
// ---------------------------------------------------------------------------

export const ReorderUnitImagesSchema = z.object({
  unit_id: z.string().uuid('unit_id must be a valid UUID'),
  order: z
    .array(z.string().uuid())
    .min(1, 'order array must not be empty')
    .max(MAX_IMAGES_PER_UNIT, `order array cannot exceed ${MAX_IMAGES_PER_UNIT} items`),
});

export type ReorderUnitImagesInput = z.infer<typeof ReorderUnitImagesSchema>;

// ---------------------------------------------------------------------------
// UnitImageRowSchema
// Mirrors the unit_images table Row type for validation of DB query results
// ---------------------------------------------------------------------------

export const UnitImageRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  storage_path: z.string().min(1),
  filename: z.string().min(1).max(255),
  mime_type: MimeTypeSchema,
  size_bytes: z.number().int().positive().max(MAX_IMAGE_SIZE_BYTES),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  is_cover: z.boolean(),
  caption: z.string().max(MAX_CAPTION_LENGTH).nullable(),
  sort_order: z.number().int().min(0),
  uploaded_by: z.string().uuid(),
  uploaded_at: z.string().datetime(),
});

export type UnitImageRow = z.infer<typeof UnitImageRowSchema>;

// ---------------------------------------------------------------------------
// NormalizedImageSchema
// Clean output type for API consumers and UI components
// Strips internal columns (org_id, uploaded_by) and adds a resolved URL field
// ---------------------------------------------------------------------------

export const NormalizedImageSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  filename: z.string(),
  mimeType: MimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  isCover: z.boolean(),
  caption: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

export type NormalizedImage = z.infer<typeof NormalizedImageSchema>;

// ---------------------------------------------------------------------------
// Tenant avatar upload schema
// Used in updateOwnTenantAvatar() Server Action (IC-5)
// Same MIME/size rules as unit images — tenant-avatars bucket has a 2 MB limit
// but we validate to 5 MB here and let the bucket policy enforce the stricter cap
// ---------------------------------------------------------------------------

export const UploadTenantAvatarSchema = z.object({
  // No extra fields needed — the tenant_id is derived server-side from the
  // authenticated user's profile_id (IC-5: never trust client-supplied tenant_id)
});

export type UploadTenantAvatarInput = z.infer<typeof UploadTenantAvatarSchema>;
