/**
 * Airtable normalizer — server-only.
 *
 * AC6:  normalizeRoom(record) maps AirtableRecord fields to the internal Room entity
 *       using Zod schema validation. Missing required fields raise a ZodError with field path.
 * AC16: normalizeRoomPhotos(record) extracts attachment fields from the configurable photo
 *       column (AIRTABLE_FIELD_ROOM_PHOTOS env var, default "Photos") and maps them to
 *       NormalizedRoomPhoto objects. Airtable CDN URLs are passed through as-is — NEVER
 *       written to Supabase Storage (IC-1).
 * AC17: Returns [] when the photo field is absent or the array is empty/null.
 *
 * Design: pure functions, no side effects, no DB calls — easily unit-testable.
 * All Airtable field name constants are defined here to avoid magic strings elsewhere.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import {
  AirtableRoomFieldsSchema,
  AirtableAttachmentSchema,
  RoomStatusSchema,
  type AirtableAttachment,
  type NormalizedRoomPhoto,
  type Room,
} from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Field name constants (matches Airtable column names in the Rooms table)
// ---------------------------------------------------------------------------

export const ROOM_FIELD = {
  NAME: 'Name',
  PROPERTY: 'Property',
  PILLOWS: 'Pillows',
  MONTHLY_RENT: 'Monthly Rent',
  STATUS: 'Status',
} as const;

/**
 * Resolve the Airtable attachment field name for room photos.
 *
 * Reads AIRTABLE_FIELD_ROOM_PHOTOS at runtime so it can be overridden per deployment
 * without a code change (IC-2). Defaults to "Photos" — the most common Airtable convention.
 *
 * @internal — exported for testing only
 */
export function resolvePhotoFieldName(): string {
  return process.env['AIRTABLE_FIELD_ROOM_PHOTOS'] ?? 'Photos';
}

// ---------------------------------------------------------------------------
// Status mapping — Airtable string → internal RoomStatus
// ---------------------------------------------------------------------------

/** Map Airtable free-text status values to the canonical internal enum. */
const STATUS_MAP: Record<string, Room['status']> = {
  // English values
  occupied: 'occupied',
  Occupied: 'occupied',
  OCCUPIED: 'occupied',
  vacant: 'vacant',
  Vacant: 'vacant',
  VACANT: 'vacant',
  empty: 'vacant',
  Empty: 'vacant',
  available: 'vacant',
  Available: 'vacant',
  maintenance: 'maintenance',
  Maintenance: 'maintenance',
  MAINTENANCE: 'maintenance',
  // Spanish values (Airtable configured in Spanish)
  'Ocupado': 'occupied',
  'ocupado': 'occupied',
  'Vacío': 'vacant',
  'vacío': 'vacant',
  'Libre': 'vacant',
  'libre': 'vacant',
  'Mantenimiento': 'maintenance',
  'mantenimiento': 'maintenance',
};

function mapStatus(raw: string | undefined | null): Room['status'] {
  if (!raw) return 'vacant';
  return STATUS_MAP[raw] ?? 'vacant';
}

// ---------------------------------------------------------------------------
// normalizeAirtableAttachment
// ---------------------------------------------------------------------------

/**
 * Map a single raw Airtable attachment object to the internal NormalizedRoomPhoto shape.
 *
 * Mapping:
 *   attachment.id       → photo.id
 *   attachment.url      → photo.url       (Airtable CDN URL — NEVER stored in Supabase)
 *   attachment.filename → photo.filename
 *   attachment.type     → photo.mimeType  (may be absent for some attachment types)
 *   attachment.size     → photo.sizeBytes
 *   attachment.width    → photo.width
 *   attachment.height   → photo.height
 *   attachment.thumbnails → photo.thumbnails (small/large/full pass-through)
 */
export function normalizeAirtableAttachment(
  attachment: AirtableAttachment
): NormalizedRoomPhoto {
  return {
    id: attachment.id,
    url: attachment.url,
    filename: attachment.filename,
    mimeType: attachment.type,
    sizeBytes: attachment.size,
    width: attachment.width,
    height: attachment.height,
    thumbnails: attachment.thumbnails,
  };
}

// ---------------------------------------------------------------------------
// normalizeRoomPhotos
// ---------------------------------------------------------------------------

/**
 * Extract and normalise photo attachments from a raw Airtable record.
 *
 * Reads the attachment field name from AIRTABLE_FIELD_ROOM_PHOTOS env var
 * (default "Photos") at runtime so each deployment can configure the real column
 * name without a code change (IC-2).
 *
 * Returns [] (AC17) when:
 *   - The field is absent from the record
 *   - The field value is null / undefined
 *   - The field value is an empty array
 *   - Individual attachment objects fail Zod validation (they are skipped)
 *
 * NEVER writes to or reads from Supabase Storage — URLs are CDN pass-through (IC-1, AC18).
 *
 * @param record  Raw AirtableRecord from the REST API
 * @returns       Array of NormalizedRoomPhoto; empty array when no photos
 */
export function normalizeRoomPhotos(record: AirtableRecord): NormalizedRoomPhoto[] {
  const fieldName = resolvePhotoFieldName();
  const rawValue = record.fields[fieldName];

  // Field absent, null, or not an array → no photos (AC17)
  if (!rawValue || !Array.isArray(rawValue) || rawValue.length === 0) {
    return [];
  }

  const photos: NormalizedRoomPhoto[] = [];

  for (const item of rawValue) {
    const parsed = AirtableAttachmentSchema.safeParse(item);
    if (parsed.success) {
      photos.push(normalizeAirtableAttachment(parsed.data));
    }
    // Invalid attachment objects are silently skipped — a missing `url` or `id`
    // should not discard the entire batch.
  }

  return photos;
}

// ---------------------------------------------------------------------------
// normalizeRoom
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable record into an internal Room entity.
 *
 * @param record  Raw AirtableRecord from the REST API
 * @returns       Typed Room entity (with photos: NormalizedRoomPhoto[])
 * @throws        ZodError when required fields (Name) are missing or invalid
 */
export function normalizeRoom(record: AirtableRecord): Room {
  // Validate fields against schema — this will throw ZodError on invalid/missing required fields
  const fields = AirtableRoomFieldsSchema.parse(record.fields);

  const rawStatus = typeof record.fields[ROOM_FIELD.STATUS] === 'string'
    ? (record.fields[ROOM_FIELD.STATUS] as string)
    : undefined;

  const status = mapStatus(rawStatus);
  // Validate normalised status is a valid enum value (belt-and-suspenders)
  const validatedStatus = RoomStatusSchema.parse(status);

  // Extract photos from the configurable attachment field (AC16, AC17)
  const photos = normalizeRoomPhotos(record);

  return {
    id: record.id,            // Use Airtable record id as id until synced to DB
    externalId: record.id,
    name: fields.Name,
    status: validatedStatus,
    monthlyRent: fields['Monthly Rent'] ?? 0,
    propertyName: fields.Property ?? '',
    unitLabel: fields.Name,   // unitLabel mirrors name; can be overridden after DB sync
    photos,
  };
}

/**
 * Normalize a batch of Airtable records.
 * Records that fail validation are skipped and their errors collected rather than thrown.
 *
 * @param records  Array of raw AirtableRecord
 * @returns        Object with successfully normalised rooms and any per-record errors
 */
export function normalizeRooms(records: AirtableRecord[]): {
  rooms: Room[];
  errors: Array<{ recordId: string; error: unknown }>;
} {
  const rooms: Room[] = [];
  const errors: Array<{ recordId: string; error: unknown }> = [];

  for (const record of records) {
    try {
      rooms.push(normalizeRoom(record));
    } catch (error) {
      errors.push({ recordId: record.id, error });
    }
  }

  return { rooms, errors };
}
