/**
 * normalizePortafolio — server-only.
 *
 * Maps a raw Airtable record from the Portafolio table to a NormalizedUnit
 * ready to be upserted into public.units.
 *
 * Design: pure function, no side effects, no DB calls.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Portafolio table)
// ---------------------------------------------------------------------------

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

export const PORTAFOLIO_FIELD = {
  LABEL:    'N° Habitación',   // new schema: was "N° de habitación"
  PROPERTY: 'Propiedad',
  TOILET:   'Baño',
  AREA_M2:  'm2',
  STATUS:   'Estado',          // now a formula — values: Disponible / Ocupado; tolerate any string
} as const;

// ---------------------------------------------------------------------------
// normalizePortafolio
// ---------------------------------------------------------------------------

export function normalizePortafolio(record: AirtableRecord, orgId: string) {
  const f = record.fields;

  const propertyLinks = Array.isArray(f[PORTAFOLIO_FIELD.PROPERTY])
    ? (f[PORTAFOLIO_FIELD.PROPERTY] as Array<{ id?: string } | string>)
    : [];

  const rawToilet =
    typeof f[PORTAFOLIO_FIELD.TOILET] === 'string'
      ? (f[PORTAFOLIO_FIELD.TOILET] as string).toLowerCase()
      : null;
  const toilet_type =
    rawToilet === 'privado' || rawToilet === 'private'
      ? 'private'
      : rawToilet === 'compartido' || rawToilet === 'shared'
      ? 'shared'
      : null;

  const rawStatus =
    typeof f[PORTAFOLIO_FIELD.STATUS] === 'string'
      ? (f[PORTAFOLIO_FIELD.STATUS] as string).toLowerCase()
      : null;
  // Estado is a formula in the new schema and may include emoji/gender variants
  // (e.g. "🟢 Disponible", "Ocupada"). DB constraint: status TEXT NOT NULL
  // CHECK (status IN ('vacant','occupied')) — substring-match and always emit
  // one of the two allowed values ('vacant' is the DB default).
  const status =
    rawStatus !== null && (rawStatus.includes('ocup') || rawStatus.includes('occupied'))
      ? 'occupied'
      : 'vacant';

  const rawM2 = f[PORTAFOLIO_FIELD.AREA_M2];
  const area_m2 =
    rawM2 !== undefined && rawM2 !== null && rawM2 !== ''
      ? isNaN(parseFloat(String(rawM2)))
        ? null
        : parseFloat(String(rawM2))
      : null;

  // Linked-record array may contain objects with .id or plain strings
  const firstProperty = propertyLinks[0];
  const propertyExtId =
    firstProperty === null || firstProperty === undefined
      ? null
      : typeof firstProperty === 'string'
      ? firstProperty
      : typeof (firstProperty as { id?: string }).id === 'string'
      ? (firstProperty as { id: string }).id
      : null;

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    label:
      typeof f[PORTAFOLIO_FIELD.LABEL] === 'string'
        ? (f[PORTAFOLIO_FIELD.LABEL] as string)
        : null,
    toilet_type,
    area_m2,
    status,
    unit_type:      toString(f['Tipo']),
    price_6months:  toNumeric(f['Precio 6 meses (S/)']),
    price_12months: toNumeric(f['Precio 12 meses (S/)']),
    price_18months: toNumeric(f['Precio 18 meses (S/)']),
    // Link helper — stripped by toDbRow before upsert
    _airtable_property_ext_id: propertyExtId,
  };
}

export type NormalizedUnit = ReturnType<typeof normalizePortafolio>;
