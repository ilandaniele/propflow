/**
 * normalizeProperty — server-only.
 *
 * Maps a raw Airtable record from the Propiedades table to a NormalizedProperty
 * ready to be upserted into public.properties.
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import type { NormalizedProperty } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Propiedades table)
// ---------------------------------------------------------------------------

export const PROPERTY_FIELD = {
  NAME:              'Propiedad',
  ADDRESS:           'Dirección',
  MODALITY:          'Modalidad',
  DISTRICT:          'Distrito',
  DESCRIPTION:       'Descripción',
  SUPPLY_NUMBER_LUZ: 'N° de suministro (L)',
  CURRENT_RESIDENTS: 'N° de residentes actuales',
  TOTAL_ROOMS:       'N° total de habitaciones',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// normalizeProperty
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Propiedades record into a NormalizedProperty.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID — must be included in every upserted row
 * @returns       NormalizedProperty ready for DB upsert (minus link-resolved fields)
 */
export function normalizeProperty(
  record: AirtableRecord,
  orgId: string
): NormalizedProperty {
  const f = record.fields;

  const name = toString(f[PROPERTY_FIELD.NAME]);

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 name ?? record.id,   // fall back to record id so NOT NULL is satisfied
    address:              toString(f[PROPERTY_FIELD.ADDRESS]),
    modality:             toString(f[PROPERTY_FIELD.MODALITY]),
    district:             toString(f[PROPERTY_FIELD.DISTRICT]),
    description:          toString(f[PROPERTY_FIELD.DESCRIPTION]),
    supply_number_luz:    toString(f[PROPERTY_FIELD.SUPPLY_NUMBER_LUZ]),
    current_residents:    toInt(f[PROPERTY_FIELD.CURRENT_RESIDENTS]),
    total_rooms:          toInt(f[PROPERTY_FIELD.TOTAL_ROOMS]),
  };
}
