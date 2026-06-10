/**
 * normalizeProperty — server-only.
 *
 * Maps a raw Airtable record from the Propiedades table (new base schema) to a
 * NormalizedProperty ready to be upserted into public.properties.
 *
 * New schema changes:
 *   - "N° de suministro (L)" renamed to "N° de suministro (Luz)"
 *   - "N° de suministro (A)" renamed to "N° de suministro (Agua)"
 *   - "N° de cliente (G)" renamed to "N° de cliente (Gas)"
 *   - Removed: Descripción, N° de residentes actuales, Código de pago (I)
 *   - Added: Tope luz (S/), Tope Agua (S/)
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
  NAME:               'Propiedad',
  ADDRESS:            'Dirección',
  MODALITY:           'Modalidad',
  DISTRICT:           'Distrito',
  TOTAL_ROOMS:        'N° total de habitaciones',
  SUPPLY_NUMBER_LUZ:  'N° de suministro (Luz)',   // renamed from (L)
  SUPPLY_NUMBER_AGUA: 'N° de suministro (Agua)',  // renamed from (A)
  N_CLIENTE_GAS:      'N° de cliente (Gas)',       // renamed from (G)
  TOPE_LUZ:           'Tope luz (S/)',
  TOPE_AGUA:          'Tope Agua (S/)',
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

function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// normalizeProperty
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Propiedades record into a NormalizedProperty.
 *
 * Removed fields (Descripción, N° de residentes actuales, Código de pago (I))
 * are intentionally absent from the result so upsert does not clobber existing
 * DB values. The DB columns remain but are not overwritten by this sync.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedProperty ready for DB upsert
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
    name:                 name ?? record.id,
    address:              toString(f[PROPERTY_FIELD.ADDRESS]),
    modality:             toString(f[PROPERTY_FIELD.MODALITY]),
    district:             toString(f[PROPERTY_FIELD.DISTRICT]),
    total_rooms:          toInt(f[PROPERTY_FIELD.TOTAL_ROOMS]),
    supply_number_luz:    toString(f[PROPERTY_FIELD.SUPPLY_NUMBER_LUZ]),
    n_suministro_agua:    toString(f[PROPERTY_FIELD.SUPPLY_NUMBER_AGUA]),
    n_cliente_gas:        toString(f[PROPERTY_FIELD.N_CLIENTE_GAS]),
    // Tope columns — only included when the Airtable field is present
    // (NormalizedProperty marks them optional so they're only written to DB when present)
    ...(f[PROPERTY_FIELD.TOPE_LUZ]  !== undefined ? { tope_luz:  toNumeric(f[PROPERTY_FIELD.TOPE_LUZ]) }  : {}),
    ...(f[PROPERTY_FIELD.TOPE_AGUA] !== undefined ? { tope_agua: toNumeric(f[PROPERTY_FIELD.TOPE_AGUA]) } : {}),
    // Removed from new schema — intentionally not mapped:
    // description, current_residents, codigo_pago_internet
  };
}
