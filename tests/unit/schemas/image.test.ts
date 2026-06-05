import { describe, it, expect } from 'vitest';
import {
  ImageFileSchema,
  UploadUnitImageSchema,
  UpdateCaptionSchema,
  ReorderUnitImagesSchema,
  UnitImageRowSchema,
  NormalizedImageSchema,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_CAPTION_LENGTH,
  MAX_IMAGES_PER_UNIT,
} from '@/lib/schemas/image';

// ---------------------------------------------------------------------------
// ImageFileSchema
// ---------------------------------------------------------------------------

describe('ImageFileSchema', () => {
  const validFile = {
    type: 'image/jpeg',
    size: 1024,
    name: 'photo.jpg',
  };

  it('accepts a valid JPEG file metadata', () => {
    expect(ImageFileSchema.safeParse(validFile).success).toBe(true);
  });

  it('accepts image/png and image/webp', () => {
    for (const type of ['image/png', 'image/webp'] as const) {
      expect(ImageFileSchema.safeParse({ ...validFile, type }).success).toBe(true);
    }
  });

  it('rejects image/gif — not in allowlist', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, type: 'image/gif' });
    expect(result.success).toBe(false);
  });

  it('rejects image/svg+xml — XSS vector', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, type: 'image/svg+xml' });
    expect(result.success).toBe(false);
  });

  it('rejects a file with size 0', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, size: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects a file over 5 MB', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, size: MAX_IMAGE_SIZE_BYTES + 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/5 MB|5242880/i);
    }
  });

  it('accepts a file exactly at the 5 MB limit', () => {
    expect(ImageFileSchema.safeParse({ ...validFile, size: MAX_IMAGE_SIZE_BYTES }).success).toBe(true);
  });

  it('rejects a file with empty name', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a name over 255 characters', () => {
    const result = ImageFileSchema.safeParse({ ...validFile, name: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UploadUnitImageSchema
// ---------------------------------------------------------------------------

describe('UploadUnitImageSchema', () => {
  const validInput = {
    unit_id: '00000000-0000-0000-0000-000000000001',
    is_cover: false,
    caption: null,
  };

  it('accepts a valid upload input', () => {
    expect(UploadUnitImageSchema.safeParse(validInput).success).toBe(true);
  });

  it('accepts is_cover as string "true" (FormData coercion)', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, is_cover: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_cover).toBe(true);
  });

  it('accepts is_cover as string "false" (FormData coercion)', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, is_cover: 'false' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_cover).toBe(false);
  });

  it('defaults is_cover to false when not provided', () => {
    const result = UploadUnitImageSchema.safeParse({ unit_id: validInput.unit_id });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_cover).toBe(false);
  });

  it('rejects an invalid unit_id (not a UUID)', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, unit_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a caption over 500 characters', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, caption: 'a'.repeat(MAX_CAPTION_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  it('accepts a caption exactly at 500 characters', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, caption: 'a'.repeat(MAX_CAPTION_LENGTH) });
    expect(result.success).toBe(true);
  });

  it('coerces width/height from string numbers', () => {
    const result = UploadUnitImageSchema.safeParse({ ...validInput, width: '1920', height: '1080' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.width).toBe(1920);
      expect(result.data.height).toBe(1080);
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateCaptionSchema
// ---------------------------------------------------------------------------

describe('UpdateCaptionSchema', () => {
  it('accepts a valid caption update', () => {
    const result = UpdateCaptionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      caption: 'A nice photo',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null caption (remove caption)', () => {
    const result = UpdateCaptionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      caption: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a caption over 500 characters', () => {
    const result = UpdateCaptionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      caption: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects caption containing HTML tags', () => {
    const result = UpdateCaptionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      caption: '<script>alert("xss")</script>',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/HTML/i);
    }
  });

  it('rejects an invalid UUID for id', () => {
    const result = UpdateCaptionSchema.safeParse({ id: 'not-a-uuid', caption: 'ok' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReorderUnitImagesSchema
// ---------------------------------------------------------------------------

describe('ReorderUnitImagesSchema', () => {
  const uuid1 = '00000000-0000-0000-0000-000000000001';
  const uuid2 = '00000000-0000-0000-0000-000000000002';

  it('accepts a valid reorder input', () => {
    const result = ReorderUnitImagesSchema.safeParse({
      unit_id: uuid1,
      order: [uuid2, uuid1],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty order array', () => {
    const result = ReorderUnitImagesSchema.safeParse({ unit_id: uuid1, order: [] });
    expect(result.success).toBe(false);
  });

  it('rejects order array exceeding MAX_IMAGES_PER_UNIT', () => {
    const order = Array.from({ length: MAX_IMAGES_PER_UNIT + 1 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
    );
    const result = ReorderUnitImagesSchema.safeParse({ unit_id: uuid1, order });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID values in order array', () => {
    const result = ReorderUnitImagesSchema.safeParse({ unit_id: uuid1, order: ['not-a-uuid'] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid unit_id', () => {
    const result = ReorderUnitImagesSchema.safeParse({ unit_id: 'bad', order: [uuid1] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UnitImageRowSchema
// ---------------------------------------------------------------------------

describe('UnitImageRowSchema', () => {
  const validRow = {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-000000000002',
    unit_id: '00000000-0000-0000-0000-000000000003',
    storage_path: 'org1/unit1/abc.jpg',
    filename: 'photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    width: 1920,
    height: 1080,
    is_cover: false,
    caption: null,
    sort_order: 0,
    uploaded_by: '00000000-0000-0000-0000-000000000004',
    uploaded_at: '2026-06-04T00:00:00.000Z',
  };

  it('parses a valid unit_images row', () => {
    expect(UnitImageRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects an invalid MIME type in the row', () => {
    const result = UnitImageRowSchema.safeParse({ ...validRow, mime_type: 'image/gif' });
    expect(result.success).toBe(false);
  });

  it('rejects size_bytes over 5 MB', () => {
    const result = UnitImageRowSchema.safeParse({ ...validRow, size_bytes: MAX_IMAGE_SIZE_BYTES + 1 });
    expect(result.success).toBe(false);
  });

  it('accepts null width and height', () => {
    const result = UnitImageRowSchema.safeParse({ ...validRow, width: null, height: null });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NormalizedImageSchema
// ---------------------------------------------------------------------------

describe('NormalizedImageSchema', () => {
  const validNormalized = {
    id: '00000000-0000-0000-0000-000000000001',
    url: 'https://example.supabase.co/storage/v1/object/sign/unit-images/path.jpg?token=abc',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    isCover: false,
    sortOrder: 0,
    createdAt: '2026-06-04T00:00:00.000Z',
  };

  it('parses a valid normalized image', () => {
    expect(NormalizedImageSchema.safeParse(validNormalized).success).toBe(true);
  });

  it('rejects an invalid URL', () => {
    const result = NormalizedImageSchema.safeParse({ ...validNormalized, url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts optional width, height, caption', () => {
    const result = NormalizedImageSchema.safeParse({
      ...validNormalized,
      width: 1920,
      height: 1080,
      caption: 'A caption',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('ALLOWED_MIME_TYPES has exactly 3 entries', () => {
    expect(ALLOWED_MIME_TYPES).toHaveLength(3);
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('image/webp');
  });

  it('MAX_IMAGE_SIZE_BYTES is exactly 5 MB', () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('MAX_CAPTION_LENGTH is 500', () => {
    expect(MAX_CAPTION_LENGTH).toBe(500);
  });

  it('MAX_IMAGES_PER_UNIT is 20', () => {
    expect(MAX_IMAGES_PER_UNIT).toBe(20);
  });
});
