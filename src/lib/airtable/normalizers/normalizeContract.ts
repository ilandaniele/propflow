/**
 * normalizeContract — server-only.
 *
 * Maps a raw Airtable record from the Historial (Contratos) table (new base schema)
 * to a NormalizedContract ready to be upserted into public.contracts.
 *
 * New schema note: the tenant link field is "Residentes" (no emoji — actual Airtable field name).
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
  TENANT_LINK:         'Residentes',                  // linked → extract ext id (no emoji in actual field)
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

// DB CHECK: status IN ('active', 'expired', 'terminated')
// 'inactive' is NOT a valid value — map all ended/terminated states to 'terminated'.
// 'expired' is reserved for date-lapsed contracts (set by the app, not by Airtable sync).
export type ContractStatus = 'active' | 'expired' | 'terminated';

const CONTRACT_STATUS_MAP: Record<string, ContractStatus> = {
  Activo:      'active',
  Active:      'active',
  ACTIVO:      'active',
  ACTIVE:      'active',
  Vigente:     'active',
  VIGENTE:     'active',
  Inactivo:    'terminated',
  Inactive:    'terminated',
  INACTIVO:    'terminated',
  INACTIVE:    'terminated',
  Finalizado:  'terminated',
  FINALIZADO:  'terminated',
  Finished:    'terminated',
  FINISHED:    'terminated',
  Terminado:   'terminated',
  TERMINADO:   'terminated',
  Vencido:     'expired',
  VENCIDO:     'expired',
  Expired:     'expired',
  EXPIRED:     'expired',
};

/**
 * Map a raw Airtable status string to one of the allowed DB CHECK values:
 *   'active' | 'expired' | 'terminated'
 *
 * Returns 'terminated' as the safe default for unrecognised values so that
 * the NOT NULL constraint on status is always satisfied during upsert.
 * Callers should treat null input as an absent field and let the DB default ('active') apply.
 */
export function mapContractStatus(raw: string | null | undefined): ContractStatus {
  if (!raw) return 'active';  // absent status → treat as active (DB default)
  return CONTRACT_STATUS_MAP[raw.trim()] ?? 'terminated';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

/**
 * Convert a date value to ISO YYYY-MM-DD.
 * Airtable date fields return ISO strings, but FORMULA fields (e.g.
 * "Fecha fin contrato") return locale-formatted strings like "26/3/2027"
 * (D/M/YYYY). Postgres rejects those, so normalize both shapes here.
 * Returns null for unparseable input rather than passing garbage through.
 */
function toIsoDate(v: unknown): string | null {
  const s = toString(v);
  if (!s) return null;
  // Already ISO (YYYY-MM-DD, possibly with time suffix)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Locale D/M/YYYY or DD/MM/YYYY (Airtable formula output)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
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
    start_date:           toIsoDate(f[CONTRACT_FIELD.START_DATE]),
    end_date:             toIsoDate(f[CONTRACT_FIELD.END_DATE]),
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
