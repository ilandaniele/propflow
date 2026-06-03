/**
 * Zod schemas for the Airtable integration layer.
 *
 * AirtableRecord     — wire shape returned by the Airtable REST API v0
 * AirtableRoomFields — fields map for the Rooms table (matched by Airtable column names)
 * Room               — internal entity shape after normalisation
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
// Per-table field shapes
// ---------------------------------------------------------------------------

/** Airtable column names in the Rooms table (Spanish / English mixed — matches real Airtable config) */
export const AirtableRoomFieldsSchema = z.object({
  // Required fields
  Name: z.string().min(1),                            // room name / unit label
  // Optional fields with defaults
  Property: z.string().optional(),                    // property name (coliving house)
  Pillows: z.number().int().min(0).optional(),        // number of pillows/beds
  'Monthly Rent': z.number().min(0).optional(),       // monthly rent in local currency
  Status: z.string().optional(),                      // occupancy status string from Airtable
});

export type AirtableRoomFields = z.infer<typeof AirtableRoomFieldsSchema>;

// ---------------------------------------------------------------------------
// Internal entity shapes (post-normalisation)
// ---------------------------------------------------------------------------

/** Canonical status values for a room in the internal entity model */
export const RoomStatusSchema = z.enum(['occupied', 'vacant', 'maintenance']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

/** Internal Room entity — used throughout the application after normalisation */
export const RoomSchema = z.object({
  id: z.string().min(1),              // internal UUID (set to externalId until synced to DB)
  externalId: z.string().min(1),      // Airtable record id (recXXXXXXXXXX)
  name: z.string().min(1),            // room name / unit label
  status: RoomStatusSchema,           // normalised occupancy status
  monthlyRent: z.number().min(0),     // monthly rent; 0 when not set
  propertyName: z.string(),           // property/coliving house name; '' when not set
  unitLabel: z.string(),              // display label for the unit; mirrors name when no separate label
});

export type Room = z.infer<typeof RoomSchema>;
