/**
 * Zod schemas for the Airtable integration layer.
 *
 * AirtableRecord          — wire shape returned by the Airtable REST API v0
 * AirtableRoomFields      — fields map for the Rooms table (matched by Airtable column names)
 * AirtableAttachmentSchema — shape of a single Airtable attachment object (images, files)
 * NormalizedRoomPhoto     — internal photo shape after normalisation (CDN URL pass-through)
 * Room                    — internal entity shape after normalisation
 *
 * NEVER import this file in 'use client' components — it is server-only.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire types — Airtable REST v0 response
// ---------------------------------------------------------------------------

export const AirtableFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

export const AirtableRecordSchema = z.object({
  id: z.string().min(1),                              // recXXXXXXXXXXXX
  createdTime: z.string().datetime().optional(),
  fields: z.record(z.string(), AirtableFieldValueSchema.optional()),
});

export type AirtableRecord = z.infer<typeof AirtableRecordSchema>;

// ---------------------------------------------------------------------------
// Airtable attachment schema (used for photo/file attachment fields)
// Shape from Airtable REST v0 docs — id, url, filename are guaranteed;
// size, type, width, height, thumbnails are best-effort optional fields.
// ---------------------------------------------------------------------------

const AirtableThumbnailEntrySchema = z.object({
  url: z.string().url(),
  width: z.number(),
  height: z.number(),
});

export const AirtableAttachmentSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  filename: z.string(),
  size: z.number().int().nonnegative().optional(),
  type: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnails: z
    .object({
      small: AirtableThumbnailEntrySchema.optional(),
      large: AirtableThumbnailEntrySchema.optional(),
      full: AirtableThumbnailEntrySchema.optional(),
    })
    .optional(),
});

export type AirtableAttachment = z.infer<typeof AirtableAttachmentSchema>;

// ---------------------------------------------------------------------------
// Per-table field shapes
// ---------------------------------------------------------------------------

/**
 * Airtable column names in the Rooms table (Spanish / English mixed — matches real Airtable config).
 *
 * NOTE: The attachment/photo field name is configurable via AIRTABLE_FIELD_ROOM_PHOTOS (default
 * "Photos"). Because the field name is dynamic, it is NOT declared as a static key here.
 * Instead, normalizeRoom() reads the configured field name at runtime and extracts the attachment
 * array from record.fields directly, bypassing schema key validation for that field.
 *
 * The `Photos` key below serves as a static fallback so TypeScript consumers that use the default
 * field name can access it through the typed fields object, but normalizeRoomPhotos() always uses
 * the runtime env var — never this hardcoded key directly.
 */
export const AirtableRoomFieldsSchema = z.object({
  // Required fields
  Name: z.string().min(1),                            // room name / unit label
  // Optional fields with defaults
  Property: z.string().optional(),                    // property name (coliving house)
  Pillows: z.number().int().min(0).optional(),        // number of pillows/beds
  'Monthly Rent': z.number().min(0).optional(),       // monthly rent in local currency
  Status: z.string().optional(),                      // occupancy status string from Airtable
  // Default photo field name — present only when AIRTABLE_FIELD_ROOM_PHOTOS="Photos" (the default).
  // The normalizer reads the actual field name from process.env at runtime (IC-2).
  Photos: z.array(AirtableAttachmentSchema).optional(),
});

export type AirtableRoomFields = z.infer<typeof AirtableRoomFieldsSchema>;

// ---------------------------------------------------------------------------
// Internal entity shapes (post-normalisation)
// ---------------------------------------------------------------------------

/** Canonical status values for a room in the internal entity model */
export const RoomStatusSchema = z.enum(['occupied', 'vacant', 'maintenance']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

/**
 * Normalised photo for a Room entity.
 *
 * URLs point directly at the Airtable CDN — they are NEVER written to Supabase Storage (IC-1).
 * thumbnailUrl is a convenience shortcut to the "large" thumbnail when present, otherwise "small".
 */
export const NormalizedRoomPhotoSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  filename: z.string(),
  mimeType: z.string().optional(),      // mapped from AirtableAttachment.type
  sizeBytes: z.number().int().nonnegative().optional(), // mapped from AirtableAttachment.size
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnails: z
    .object({
      small: z.object({ url: z.string().url(), width: z.number(), height: z.number() }).optional(),
      large: z.object({ url: z.string().url(), width: z.number(), height: z.number() }).optional(),
      full: z.object({ url: z.string().url(), width: z.number(), height: z.number() }).optional(),
    })
    .optional(),
});

export type NormalizedRoomPhoto = z.infer<typeof NormalizedRoomPhotoSchema>;

/** Internal Room entity — used throughout the application after normalisation */
export const RoomSchema = z.object({
  id: z.string().min(1),              // internal UUID (set to externalId until synced to DB)
  externalId: z.string().min(1),      // Airtable record id (recXXXXXXXXXX)
  name: z.string().min(1),            // room name / unit label
  status: RoomStatusSchema,           // normalised occupancy status
  monthlyRent: z.number().min(0),     // monthly rent; 0 when not set
  propertyName: z.string(),           // property/coliving house name; '' when not set
  unitLabel: z.string(),              // display label for the unit; mirrors name when no separate label
  /** Airtable CDN photo URLs — empty array when no attachment field found (IC-1: never stored) */
  photos: z.array(NormalizedRoomPhotoSchema).default([]),
});

export type Room = z.infer<typeof RoomSchema>;
