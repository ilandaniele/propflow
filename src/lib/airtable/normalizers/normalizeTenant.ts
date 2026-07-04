/**
 * normalizeTenant — server-only.
 *
 * Maps a raw Airtable record from the Residentes table (new base schema) to a
 * NormalizedTenant ready to be upserted into public.tenants.
 *
 * New schema note: contract fields (rent, deposit, dates, etc.) have MOVED to
 * Historial (Contratos). They are NOT mapped here — their keys are intentionally
 * absent from the result so that upsert does not overwrite values already set by
 * the contracts sync. The unit/property link is also gone from Residentes; those
 * are now derivable only via contracts.
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import type { NormalizedTenant } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Residentes table)
// ---------------------------------------------------------------------------

export const TENANT_FIELD = {
  // Formula/computed display name — may not always be populated
  FULL_NAME_FORMULA: 'Nombre(s) y Apellidos',
  FIRST_NAME:        'Nombre(s)',
  LAST_NAME:         'Apellidos',
  DNI:               'N° DNI',
  BIRTH_DATE:        'Fecha de nacimiento',
  PHONE:             'Número celular',
  EMAIL:             'Correo electrónico',
  STATUS:            'Estado',
  // Responsable is a linked array — first element is the ext id
  RESPONSABLE:       'Responsable',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
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
 * Only fields that exist in the NEW base schema are mapped. Contract-related
 * fields (monthly_rent, deposit, contract_start, contract_end, duration_months,
 * payment_due_day) are intentionally omitted — they live in Historial (Contratos)
 * and are set by the contracts sync. Property/unit link is also omitted.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedTenant (contract/property/unit fields absent → no DB clobber)
 */
export function normalizeTenant(
  record: AirtableRecord,
  orgId: string
): NormalizedTenant {
  const f = record.fields;

  const firstName = toString(f[TENANT_FIELD.FIRST_NAME]);
  const lastName  = toString(f[TENANT_FIELD.LAST_NAME]);
  const dni       = toString(f[TENANT_FIELD.DNI]);

  // Formula field may or may not be populated — fall back to concatenation
  const fullNameFormula = toString(f[TENANT_FIELD.FULL_NAME_FORMULA]);
  const fullName = fullNameFormula ?? (`${firstName ?? ''} ${lastName ?? ''}`.trim() || record.id);

  // Photo DNI attachment — only include if present, to avoid clobbering
  const photoDniUrl = 'Foto DNI' in f
    ? (extractFirstAttachmentUrl(f['Foto DNI']) ?? null)
    : undefined;

  const result: NormalizedTenant = {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    full_name:            fullName,
    first_name:           firstName,
    last_name:            lastName,
    dni:                  dni,
    // Mirror into document_number — the column the app UI/CRUD reads.
    document_number:      dni,
    birth_date:           toString(f[TENANT_FIELD.BIRTH_DATE]),
    phone:                toString(f[TENANT_FIELD.PHONE]),
    email:                toString(f[TENANT_FIELD.EMAIL]),
    tenant_status:        toString(f[TENANT_FIELD.STATUS]),
    // unit_id is intentionally OMITTED (not null) — the Residentes table no
    // longer carries a unit link, so it can only be derived from active
    // contracts (cron Phase 3). Emitting null here would clobber that value on
    // every sync. sync-entities re-adds unit_id only if a Residentes-level link
    // ever resolves. NOTE: tenants has NO property_id column either.
    // Private link helper — responsable resolved in sync-entities.ts
    _airtable_property_ext_id: null,
    _airtable_unit_label:      null,
  };

  // Only include photo_url when the field was actually present in this record
  if (photoDniUrl !== undefined) {
    result.photo_url = photoDniUrl;
  }

  result.occupation           = toString(f['Ocupación']);
  result.foto_tiu_url         = extractFirstAttachmentUrl(f['Foto TIU']) ?? null;
  result.solvency_doc_url     = extractFirstAttachmentUrl(f['Doc. de solvencia']) ?? null;
  result.acquisition_channels = Array.isArray(f['Canal de captación']) ? (f['Canal de captación'] as string[]).join(', ') : null;
  result.exit_reason          = toString(f['Motivo de salida']);

  return result;
}
