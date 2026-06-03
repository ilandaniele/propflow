/**
 * Airtable normalizer — server-only.
 *
 * AC6: normalizeRoom(record) maps AirtableRecord fields to the internal Room entity
 * using Zod schema validation. Missing required fields raise a ZodError with field path.
 *
 * Design: pure function, no side effects, no DB calls — easily unit-testable.
 * All Airtable field name constants are defined here to avoid magic strings elsewhere.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { AirtableRoomFieldsSchema, RoomStatusSchema, type Room } from '@/lib/schemas/airtable';

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
// normalizeRoom
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable record into an internal Room entity.
 *
 * @param record  Raw AirtableRecord from the REST API
 * @returns       Typed Room entity
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

  return {
    id: record.id,            // Use Airtable record id as id until synced to DB
    externalId: record.id,
    name: fields.Name,
    status: validatedStatus,
    monthlyRent: fields['Monthly Rent'] ?? 0,
    propertyName: fields.Property ?? '',
    unitLabel: fields.Name,   // unitLabel mirrors name; can be overridden after DB sync
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
