/**
 * normalizeResponsable — server-only.
 *
 * Maps a raw Airtable record from the Responsables table (new base schema) to a
 * normalized shape ready to be upserted into public.responsables.
 *
 * New schema changes:
 *   - Full name field is now "Nombre completo" (was "Nombre(s) y apellidos")
 *   - Employment field is "Tipo de empleo" (was "Empleo")
 *   - Estado field NO LONGER EXISTS — status key is omitted from the result
 *
 * Design: pure function, no side effects, no DB calls.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Field name constants
// ---------------------------------------------------------------------------

export const RESPONSABLE_FIELD = {
  FULL_NAME:  'Nombre completo',      // was "Nombre(s) y apellidos"
  DNI:        'N° DNI',
  PHONE:      'Número celular',
  EMAIL:      'Correo electrónico',
  EMPLOYMENT: 'Tipo de empleo',       // was "Empleo"
  COMPANY:    'Empresa',
  JOB_TITLE:  'Cargo',
  INDUSTRY:   'Rubro del negocio',
  PHOTO_DNI:  'Foto DNI',
} as const;

// ---------------------------------------------------------------------------
// normalizeResponsable
// ---------------------------------------------------------------------------

export function normalizeResponsable(record: AirtableRecord, orgId: string) {
  const f = record.fields;

  const attachments = Array.isArray(f[RESPONSABLE_FIELD.PHOTO_DNI])
    ? (f[RESPONSABLE_FIELD.PHOTO_DNI] as Array<{ url?: string }>)
    : [];

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    full_name:
      typeof f[RESPONSABLE_FIELD.FULL_NAME] === 'string'
        ? (f[RESPONSABLE_FIELD.FULL_NAME] as string)
        : null,
    dni:
      typeof f[RESPONSABLE_FIELD.DNI] === 'string'
        ? (f[RESPONSABLE_FIELD.DNI] as string)
        : null,
    phone:
      typeof f[RESPONSABLE_FIELD.PHONE] === 'string'
        ? (f[RESPONSABLE_FIELD.PHONE] as string)
        : null,
    email:
      typeof f[RESPONSABLE_FIELD.EMAIL] === 'string'
        ? (f[RESPONSABLE_FIELD.EMAIL] as string)
        : null,
    employment:
      typeof f[RESPONSABLE_FIELD.EMPLOYMENT] === 'string'
        ? (f[RESPONSABLE_FIELD.EMPLOYMENT] as string)
        : null,
    company:
      typeof f[RESPONSABLE_FIELD.COMPANY] === 'string'
        ? (f[RESPONSABLE_FIELD.COMPANY] as string)
        : null,
    job_title:
      typeof f[RESPONSABLE_FIELD.JOB_TITLE] === 'string'
        ? (f[RESPONSABLE_FIELD.JOB_TITLE] as string)
        : null,
    industry:
      typeof f[RESPONSABLE_FIELD.INDUSTRY] === 'string'
        ? (f[RESPONSABLE_FIELD.INDUSTRY] as string)
        : null,
    // "Estado" field no longer exists in the new Responsables schema.
    // The key is intentionally absent so upsert does not null-overwrite existing DB values.
    photo_url: attachments[0]?.url ?? null,
  };
}

export type NormalizedResponsable = ReturnType<typeof normalizeResponsable>;
