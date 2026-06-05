/**
 * tests/unit/airtable/room-photos.test.ts
 *
 * W4 — Airtable Room attachment extraction
 *
 * AC16: normalizeRoom() with a Photos field → Room.photos array populated
 * AC17: normalizeRoom() without a Photos field → Room.photos === []
 * AC18: Photos are CDN URLs (no Supabase Storage path, no write side-effects)
 *
 * Also covers:
 *   - AIRTABLE_FIELD_ROOM_PHOTOS env var override
 *   - Thumbnail normalization (small / large / full pass-through)
 *   - Empty / null attachment array → []
 *   - Malformed individual attachment skipped (batch robustness)
 *   - AirtableAttachmentSchema validates correct wire shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeRoom,
  normalizeRoomPhotos,
  normalizeAirtableAttachment,
  resolvePhotoFieldName,
  ROOM_FIELD,
} from '@/lib/airtable/normalize';
import { AirtableAttachmentSchema, RoomSchema } from '@/lib/schemas/airtable';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A fully-populated Airtable attachment object (wire shape) */
const FULL_ATTACHMENT = {
  id: 'attABCDEF1234567',
  url: 'https://dl.airtable.com/foo/bar.jpg',
  filename: 'room-photo.jpg',
  size: 204800,
  type: 'image/jpeg',
  width: 1920,
  height: 1080,
  thumbnails: {
    small: { url: 'https://dl.airtable.com/foo/small_bar.jpg', width: 64, height: 36 },
    large: { url: 'https://dl.airtable.com/foo/large_bar.jpg', width: 512, height: 288 },
    full: { url: 'https://dl.airtable.com/foo/full_bar.jpg', width: 1920, height: 1080 },
  },
};

/** A minimal attachment (only the required fields) */
const MINIMAL_ATTACHMENT = {
  id: 'attMINIMAL000001',
  url: 'https://dl.airtable.com/minimal/photo.png',
  filename: 'minimal.png',
};

function makeRecord(
  extraFields: Record<string, unknown> = {},
  id = 'recABCD1234567890'
): AirtableRecord {
  return {
    id,
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      [ROOM_FIELD.NAME]: 'Habitación 101',
      [ROOM_FIELD.PROPERTY]: 'Casa Alameda',
      [ROOM_FIELD.MONTHLY_RENT]: 550,
      [ROOM_FIELD.STATUS]: 'Vacant',
      ...extraFields,
    },
  };
}

// ---------------------------------------------------------------------------
// resolvePhotoFieldName
// ---------------------------------------------------------------------------

describe('resolvePhotoFieldName', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // Clone the env so mutations don't leak between tests
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns "Photos" by default when AIRTABLE_FIELD_ROOM_PHOTOS is unset', () => {
    delete process.env['AIRTABLE_FIELD_ROOM_PHOTOS'];
    expect(resolvePhotoFieldName()).toBe('Photos');
  });

  it('returns the env var value when AIRTABLE_FIELD_ROOM_PHOTOS is set', () => {
    process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] = 'Fotos';
    expect(resolvePhotoFieldName()).toBe('Fotos');
  });

  it('returns an arbitrary custom value', () => {
    process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] = 'Room Images';
    expect(resolvePhotoFieldName()).toBe('Room Images');
  });
});

// ---------------------------------------------------------------------------
// AirtableAttachmentSchema — wire shape validation
// ---------------------------------------------------------------------------

describe('AirtableAttachmentSchema', () => {
  it('parses a fully-populated attachment (test scenario 18)', () => {
    const result = AirtableAttachmentSchema.safeParse(FULL_ATTACHMENT);
    expect(result.success).toBe(true);
  });

  it('parses a minimal attachment (only id + url + filename)', () => {
    const result = AirtableAttachmentSchema.safeParse(MINIMAL_ATTACHMENT);
    expect(result.success).toBe(true);
  });

  it('rejects an attachment with a non-URL url', () => {
    const result = AirtableAttachmentSchema.safeParse({
      ...MINIMAL_ATTACHMENT,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attachment missing the required url field', () => {
    const { url: _omit, ...noUrl } = FULL_ATTACHMENT;
    const result = AirtableAttachmentSchema.safeParse(noUrl);
    expect(result.success).toBe(false);
  });

  it('rejects an attachment missing the required id field', () => {
    const { id: _omit, ...noId } = FULL_ATTACHMENT;
    const result = AirtableAttachmentSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('rejects an attachment missing the required filename field', () => {
    const { filename: _omit, ...noFilename } = FULL_ATTACHMENT;
    const result = AirtableAttachmentSchema.safeParse(noFilename);
    expect(result.success).toBe(false);
  });

  it('accepts thumbnail with non-URL url when thumbnails.small.url is valid', () => {
    const result = AirtableAttachmentSchema.safeParse({
      ...MINIMAL_ATTACHMENT,
      thumbnails: {
        small: { url: 'https://dl.airtable.com/small.jpg', width: 64, height: 36 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects thumbnail with a non-URL thumbnail url', () => {
    const result = AirtableAttachmentSchema.safeParse({
      ...MINIMAL_ATTACHMENT,
      thumbnails: {
        small: { url: 'bad-url', width: 64, height: 36 },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeAirtableAttachment
// ---------------------------------------------------------------------------

describe('normalizeAirtableAttachment', () => {
  it('maps all fields from a full attachment', () => {
    const parsed = AirtableAttachmentSchema.parse(FULL_ATTACHMENT);
    const photo = normalizeAirtableAttachment(parsed);

    expect(photo.id).toBe('attABCDEF1234567');
    expect(photo.url).toBe('https://dl.airtable.com/foo/bar.jpg');
    expect(photo.filename).toBe('room-photo.jpg');
    expect(photo.mimeType).toBe('image/jpeg');
    expect(photo.sizeBytes).toBe(204800);
    expect(photo.width).toBe(1920);
    expect(photo.height).toBe(1080);
  });

  it('maps thumbnail.small, thumbnail.large, thumbnail.full', () => {
    const parsed = AirtableAttachmentSchema.parse(FULL_ATTACHMENT);
    const photo = normalizeAirtableAttachment(parsed);

    expect(photo.thumbnails?.small?.url).toBe('https://dl.airtable.com/foo/small_bar.jpg');
    expect(photo.thumbnails?.large?.url).toBe('https://dl.airtable.com/foo/large_bar.jpg');
    expect(photo.thumbnails?.full?.url).toBe('https://dl.airtable.com/foo/full_bar.jpg');
    expect(photo.thumbnails?.small?.width).toBe(64);
    expect(photo.thumbnails?.large?.height).toBe(288);
  });

  it('maps a minimal attachment — optional fields are undefined', () => {
    const parsed = AirtableAttachmentSchema.parse(MINIMAL_ATTACHMENT);
    const photo = normalizeAirtableAttachment(parsed);

    expect(photo.id).toBe('attMINIMAL000001');
    expect(photo.url).toBe('https://dl.airtable.com/minimal/photo.png');
    expect(photo.filename).toBe('minimal.png');
    expect(photo.mimeType).toBeUndefined();
    expect(photo.sizeBytes).toBeUndefined();
    expect(photo.width).toBeUndefined();
    expect(photo.height).toBeUndefined();
    expect(photo.thumbnails).toBeUndefined();
  });

  it('photo URL is the Airtable CDN URL — does NOT contain supabase.co (AC18)', () => {
    const parsed = AirtableAttachmentSchema.parse(FULL_ATTACHMENT);
    const photo = normalizeAirtableAttachment(parsed);
    expect(photo.url).not.toContain('supabase.co');
    expect(photo.url).toContain('airtable.com');
  });
});

// ---------------------------------------------------------------------------
// normalizeRoomPhotos — AC16, AC17
// ---------------------------------------------------------------------------

describe('normalizeRoomPhotos', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env['AIRTABLE_FIELD_ROOM_PHOTOS'];
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  // AC16 — with Photos field
  it('AC16: returns normalised photos when the "Photos" field contains attachments', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toHaveLength(1);
    expect(photos[0].url).toBe('https://dl.airtable.com/foo/bar.jpg');
    expect(photos[0].filename).toBe('room-photo.jpg');
  });

  it('AC16: returns multiple photos when the field contains multiple attachments', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT, MINIMAL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toHaveLength(2);
    expect(photos[1].id).toBe('attMINIMAL000001');
  });

  // AC17 — without Photos field
  it('AC17: returns [] when the Photos field is absent from the record', () => {
    const record = makeRecord({}); // no Photos field
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  it('AC17: returns [] when the Photos field is explicitly null', () => {
    const record = makeRecord({ Photos: null });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  it('AC17: returns [] when the Photos field is an empty array', () => {
    const record = makeRecord({ Photos: [] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  it('AC17: returns [] when the Photos field is undefined', () => {
    const record = makeRecord({ Photos: undefined });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  // Env var override
  it('reads the custom field name from AIRTABLE_FIELD_ROOM_PHOTOS', () => {
    process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] = 'Fotos';
    const record = makeRecord({ Fotos: [FULL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe('attABCDEF1234567');
  });

  it('returns [] for the default "Photos" field when env var is set to a different name', () => {
    process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] = 'Fotos';
    // Record has Photos (old name) but normalizer now looks for Fotos
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  // Batch robustness
  it('skips invalid attachments and returns only valid ones', () => {
    const badAttachment = { id: 'bad', url: 'not-a-url', filename: 'bad.jpg' };
    const record = makeRecord({ Photos: [badAttachment, FULL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    // The bad attachment (invalid url) should be skipped
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe('attABCDEF1234567');
  });

  it('returns [] when all attachments are invalid', () => {
    const bad1 = { id: 'b1', url: 'not-a-url', filename: 'a.jpg' };
    const bad2 = { url: 'https://dl.airtable.com/x.jpg', filename: 'b.jpg' }; // missing id
    const record = makeRecord({ Photos: [bad1, bad2] });
    const photos = normalizeRoomPhotos(record);
    expect(photos).toEqual([]);
  });

  // Thumbnail normalization
  it('passes thumbnails through to the NormalizedRoomPhoto', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos[0].thumbnails?.large?.url).toBe('https://dl.airtable.com/foo/large_bar.jpg');
    expect(photos[0].thumbnails?.small?.width).toBe(64);
    expect(photos[0].thumbnails?.full?.height).toBe(1080);
  });

  it('photos without thumbnails have thumbnails === undefined', () => {
    const record = makeRecord({ Photos: [MINIMAL_ATTACHMENT] });
    const photos = normalizeRoomPhotos(record);
    expect(photos[0].thumbnails).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeRoom — integration (photos wired into Room entity)
// ---------------------------------------------------------------------------

describe('normalizeRoom — photos integration (AC16, AC17)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env['AIRTABLE_FIELD_ROOM_PHOTOS'];
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('AC16: normalizeRoom() returns Room.photos populated when Photos field present', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT, MINIMAL_ATTACHMENT] });
    const room = normalizeRoom(record);
    expect(room.photos).toHaveLength(2);
    expect(room.photos[0].url).toBe('https://dl.airtable.com/foo/bar.jpg');
    expect(room.photos[1].filename).toBe('minimal.png');
  });

  it('AC16: each photo in Room.photos has url and filename', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const room = normalizeRoom(record);
    expect(room.photos[0].url).toBeTruthy();
    expect(room.photos[0].filename).toBeTruthy();
  });

  it('AC16: thumbnails are present on Room.photos[0] when attachment has thumbnails', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const room = normalizeRoom(record);
    expect(room.photos[0].thumbnails?.small).toBeDefined();
    expect(room.photos[0].thumbnails?.large).toBeDefined();
  });

  it('AC17: normalizeRoom() returns Room.photos === [] when Photos field absent', () => {
    const record = makeRecord({});
    const room = normalizeRoom(record);
    expect(room.photos).toEqual([]);
  });

  it('AC17: normalizeRoom() returns Room.photos === [] for empty Photos array', () => {
    const record = makeRecord({ Photos: [] });
    const room = normalizeRoom(record);
    expect(room.photos).toEqual([]);
  });

  it('AC18: photo URLs are Airtable CDN (dl.airtable.com) — not Supabase Storage paths', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const room = normalizeRoom(record);
    for (const photo of room.photos) {
      expect(photo.url).not.toContain('supabase.co');
    }
  });

  it('resulting Room entity validates against RoomSchema (photos included)', () => {
    const record = makeRecord({ Photos: [FULL_ATTACHMENT] });
    const room = normalizeRoom(record);
    expect(() => RoomSchema.parse(room)).not.toThrow();
  });

  it('resulting Room entity validates against RoomSchema when photos is []', () => {
    const record = makeRecord({});
    const room = normalizeRoom(record);
    expect(() => RoomSchema.parse(room)).not.toThrow();
    expect(room.photos).toEqual([]);
  });

  it('normalizeRoom() still throws ZodError when Name field is missing (regression)', () => {
    const record = makeRecord({ [ROOM_FIELD.NAME]: undefined, Photos: [FULL_ATTACHMENT] });
    expect(() => normalizeRoom(record)).toThrow();
  });

  it('env var override works end-to-end through normalizeRoom()', () => {
    process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] = 'Fotos';
    const record = makeRecord({ Fotos: [FULL_ATTACHMENT] });
    const room = normalizeRoom(record);
    expect(room.photos).toHaveLength(1);
    expect(room.photos[0].id).toBe('attABCDEF1234567');
  });
});
