/**
 * Zod schemas for unit image upload validation.
 *
 * AC4: Upload rejects invalid mime with INVALID_FILE_TYPE 400.
 * AC5: Upload rejects > 5MB with FILE_TOO_LARGE 400.
 */

import { z } from 'zod';

export const UNIT_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UnitImageMimeType = (typeof UNIT_IMAGE_ALLOWED_MIME_TYPES)[number];

export const UNIT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const UNIT_IMAGE_MAX_CAPTION_LENGTH = 280;
export const UNIT_IMAGE_MAX_PER_UNIT = 20;

export const UnitImageUploadSchema = z.object({
  unit_id: z.string().uuid(),
});

export const SetCoverImageSchema = z.object({
  image_id: z.string().uuid(),
  unit_id: z.string().uuid(),
});

export const DeleteUnitImageSchema = z.object({
  image_id: z.string().uuid(),
  unit_id: z.string().uuid(),
});

export const ReorderUnitImagesSchema = z.object({
  unit_id: z.string().uuid(),
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export type UnitImageUploadInput = z.infer<typeof UnitImageUploadSchema>;
export type SetCoverImageInput = z.infer<typeof SetCoverImageSchema>;
export type DeleteUnitImageInput = z.infer<typeof DeleteUnitImageSchema>;
export type ReorderUnitImagesInput = z.infer<typeof ReorderUnitImagesSchema>;
