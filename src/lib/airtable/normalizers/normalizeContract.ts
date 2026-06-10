/**
 * normalizeContract — server-only.
 *
 * Maps a raw Airtable record from the Historial (Contratos) table (new base schema)
 * to a NormalizedContract ready to be upserted into public.contracts.
 *
 * New schema note: the tenant link field is "👤 Residentes" (WITH the emoji prefix).
 * The unit link field is "Habitacion" (no tilde). The property link is "Propiedad".
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';
import type { NormalizedContract } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Historial table)
// ---------------------------------------------------------------------------

export const CONTRACT_FIELD = {
  CONTRACT_CODE:       'Contrato ID',               // formula
  // Lookup field — returns display value(s), not record ids
  TENANT_NAME_LOOKUP:  'Nombres y Apellidos',        // lookup display
  // Linked records — must use EXACT names including emoji
  TENANT_LINK:         '👤 Residentes',              // linked → extract ext id
  PROPERTY_LINK:       'Propiedad',                  // linked → extract ext id
  UNIT_LINK:           'Habitacion',                 // linked (no tilde) → extract ext id
  CONTRACT_TYPE:       'Tipo de contrato',
  START_DATE:          'Fecha de inicio',
  END_DATE:            'Fecha fin contrato',          // formula
  DURATION_MONTHS:     'Duración pactada (meses)',
  MONTHLY_RENT:        'Renta pactada (S/)',
  DEPOSIT:             'Garantía (S/)',
  DEPOSIT_RECEIPT_URL: 'Const. garantía',             // attachments
  STATUS:              'Estado contrato',
} as const;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const CONTRACT_STATUS_MAP: Record<string, string> = {
  Activo:      'active',
  Active:      'active',
  ACTIVO:      'active',
  ACTIVE:      'active',
  Vigente:     'active',
  VIGENTE:     'active',
  Inactivo:    'inactive',
  Inactive:    'inactive',
  INACTIVO:    'inactive',
  INACTIVE:    'inactive',
  Finalizado:  'inactive',
  FINALIZADO:  'inactive',
  Finished:    'inactive',
  FINISHED:    'inactive',
  Terminado:   'inactive',
  TERMINADO:   'inactive',
};

export function mapContractStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return CONTRACT_STATUS_MAP[raw.trim()] ?? null;
}

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

function extractFirstAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const url = first['url'];
  return typeof url === 'string' && url ? url : null;
}

// ---------------------------------------------------------------------------
// normalizeContract
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Historial (Contratos) record into a NormalizedContract.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedContract; tenant_id/unit_id/property_id set by link resolver
 */
export function normalizeContract(
  record: AirtableRecord,
  orgId: string
): NormalizedContract {
  const f = record.fields;

  // "👤 Residentes" is the exact linked field name (with emoji)
  const tenantExtId  = extractFirstLinkedId(f[CONTRACT_FIELD.TENANT_LINK]);
  const unitExtId    = extractFirstLinkedId(f[CONTRACT_FIELD.UNIT_LINK]);

  const rawStatus = toString(f[CONTRACT_FIELD.STATUS]);

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    contract_code:        toString(f[CONTRACT_FIELD.CONTRACT_CODE]),
    contract_type:        toString(f[CONTRACT_FIELD.CONTRACT_TYPE]),
    start_date:           toString(f[CONTRACT_FIELD.START_DATE]),
    end_date:             toString(f[CONTRACT_FIELD.END_DATE]),
    duration_months:      toInt(f[CONTRACT_FIELD.DURATION_MONTHS]),
    monthly_rent:         toNumeric(f[CONTRACT_FIELD.MONTHLY_RENT]),
    deposit:              toNumeric(f[CONTRACT_FIELD.DEPOSIT]),
    deposit_receipt_url:  extractFirstAttachmentUrl(f[CONTRACT_FIELD.DEPOSIT_RECEIPT_URL]),
    status:               mapContractStatus(rawStatus),
    // Resolved link fields — populated downstream by link resolver
    tenant_id:            null,
    unit_id:              null,
    // Private fields for link resolver
    _airtable_tenant_ext_id: tenantExtId,
    _airtable_unit_ext_id:   unitExtId,
  };
}
