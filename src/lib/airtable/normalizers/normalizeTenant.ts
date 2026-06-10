/**
 * normalizeTenant — server-only.
 *
 * Maps a raw Airtable record from the Residentes table to a NormalizedTenant
 * ready to be upserted into public.tenants.
 *
 * Linked-record fields (arrays of Airtable record ids) are extracted to the
 * private _airtable_* fields for downstream link resolution; property_id and
 * unit_id are left null here and filled by the link resolver.
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';
import type { NormalizedTenant } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Residentes table)
// ---------------------------------------------------------------------------

export const TENANT_FIELD = {
  FULL_NAME:       'Nombre(s) y apellidos',
  CODIGO:          'Codigo',
  FIRST_NAME:      'Nombre(s)',
  LAST_NAME:       'Apellidos',
  DNI:             'N° DNI',
  BIRTH_DATE:      'Fecha de nacimiento',
  PHONE:           'Número celular',
  EMAIL:           'Correo electrónico',
  UNIT_LABEL:      'N° de habitación',    // linked array → extract label of first
  PROPERTY_NAME:   'Propiedad',           // linked array → extract ext id of first
  CONTRACT_START:  'Fecha de inicio',
  DURATION_MONTHS: 'Duración',
  CONTRACT_END:    'Fecha fin',
  PAYMENT_DUE_DAY: 'Fecha de pago',
  MONTHLY_RENT:    'Renta',
  DEPOSIT:         'Garantía',
  STATUS:          'Estado',
  PHOTO:           'Foto de perfil',  // Airtable attachment field — must be created manually first
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

/**
 * Extract a display string (not a record id) from a linked-record array.
 * Airtable may return either an array of record ids (strings starting "rec")
 * or an array of display strings depending on the field configuration.
 * For "N° de habitación" we want the display label, not the record id.
 */
function extractFirstLinkedLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (typeof first === 'string') return first.trim() || null;
  return null;
}

/**
 * Extract the URL from the first attachment in an Airtable attachment array.
 * Returns undefined (not null) so callers can distinguish "field absent" from
 * "field present but empty" — callers must NOT clobber existing values with null
 * when this returns undefined.
 */
function extractFirstAttachmentUrl(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const first = value[0] as Record<string, unknown> | undefined;
  if (!first) return undefined;
  const url = first['url'];
  return typeof url === 'string' && url ? url : undefined;
}

// ---------------------------------------------------------------------------
// normalizeTenant
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Residentes record into a NormalizedTenant.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedTenant; property_id/unit_id remain null (set by link resolver)
 */
export function normalizeTenant(
  record: AirtableRecord,
  orgId: string
): NormalizedTenant {
  const f = record.fields;

  const fullName = toString(f[TENANT_FIELD.FULL_NAME]);
  const firstName = toString(f[TENANT_FIELD.FIRST_NAME]);
  const lastName = toString(f[TENANT_FIELD.LAST_NAME]);

  // Linked arrays — extract first element
  const propertyExtId = extractFirstLinkedId(f[TENANT_FIELD.PROPERTY_NAME]);
  const unitLabel     = extractFirstLinkedLabel(f[TENANT_FIELD.UNIT_LABEL]);

  // Attachment field — only map if present in this record; do NOT clobber existing photo_url with null
  const photoUrl = TENANT_FIELD.PHOTO in f
    ? (extractFirstAttachmentUrl(f[TENANT_FIELD.PHOTO]) ?? null)
    : undefined;

  const normalized: ReturnType<typeof buildNormalized> = buildNormalized({
    orgId, record, fullName, firstName, lastName, propertyExtId, unitLabel, photoUrl,
    f,
  });
  return normalized;
}

// Extracted to keep normalizeTenant readable
function buildNormalized(args: {
  orgId: string;
  record: AirtableRecord;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  propertyExtId: string | null;
  unitLabel: string | null;
  photoUrl: string | null | undefined;
  f: AirtableRecord['fields'];
}): NormalizedTenant {
  const { orgId, record, fullName, firstName, lastName, propertyExtId, unitLabel, photoUrl, f } = args;
  const result: NormalizedTenant = {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    full_name:            fullName ?? (`${firstName ?? ''} ${lastName ?? ''}`.trim() || record.id),
    first_name:           firstName,
    last_name:            lastName,
    codigo:               toString(f[TENANT_FIELD.CODIGO]),
    dni:                  toString(f[TENANT_FIELD.DNI]),
    birth_date:           toString(f[TENANT_FIELD.BIRTH_DATE]),
    phone:                toString(f[TENANT_FIELD.PHONE]),
    email:                toString(f[TENANT_FIELD.EMAIL]),
    payment_due_day:      toInt(f[TENANT_FIELD.PAYMENT_DUE_DAY]),
    monthly_rent:         toNumeric(f[TENANT_FIELD.MONTHLY_RENT]),
    deposit:              toNumeric(f[TENANT_FIELD.DEPOSIT]),
    tenant_status:        toString(f[TENANT_FIELD.STATUS]),
    contract_start:       toString(f[TENANT_FIELD.CONTRACT_START]),
    contract_end:         toString(f[TENANT_FIELD.CONTRACT_END]),
    duration_months:      toInt(f[TENANT_FIELD.DURATION_MONTHS]),
    // Resolved link fields — populated downstream by link resolver
    property_id:          null,
    unit_id:              null,
    // Private fields for link resolver
    _airtable_property_ext_id: propertyExtId,
    _airtable_unit_label:      unitLabel,
  };
  // photo_url: only include in normalized result when the Airtable field was present.
  // undefined means "not in record" — callers must use SQL coalesce / skip if undefined.
  if (photoUrl !== undefined) {
    result.photo_url = photoUrl;
  }
  return result;
}
