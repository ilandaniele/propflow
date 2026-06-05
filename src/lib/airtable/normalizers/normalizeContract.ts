/**
 * normalizeContract — server-only.
 *
 * Maps a raw Airtable record from the Historial table to a NormalizedContract
 * ready to be upserted into public.contracts.
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
  CONTRACT_CODE:       'Contrato ID',
  TENANT_NAME:         'Residente',          // linked array → extract first
  CONTRACT_TYPE:       'Tipo de contrato',
  START_DATE:          'Fecha inicio',
  DURATION_MONTHS:     'Duración (meses)',
  END_DATE:            'Fecha fin',
  MONTHLY_RENT:        'Renta',
  DEPOSIT:             'Garantía',
  DEPOSIT_RECEIPT_URL: 'Constancia de garantía',
  STATUS:              'Estado',
} as const;

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const CONTRACT_STATUS_MAP: Record<string, string> = {
  Activo:      'active',
  Active:      'active',
  ACTIVO:      'active',
  ACTIVE:      'active',
  Inactivo:    'inactive',
  Inactive:    'inactive',
  INACTIVO:    'inactive',
  INACTIVE:    'inactive',
  Finalizado:  'inactive',
  FINALIZADO:  'inactive',
  Finished:    'inactive',
  FINISHED:    'inactive',
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

// ---------------------------------------------------------------------------
// normalizeContract
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Historial record into a NormalizedContract.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedContract; tenant_id/unit_id remain null (set by link resolver)
 */
export function normalizeContract(
  record: AirtableRecord,
  orgId: string
): NormalizedContract {
  const f = record.fields;

  // Linked array — "Residente" is a linked record field; extract external id for resolver
  const tenantExtId = extractFirstLinkedId(f[CONTRACT_FIELD.TENANT_NAME]);

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
    deposit_receipt_url:  toString(f[CONTRACT_FIELD.DEPOSIT_RECEIPT_URL]),
    status:               mapContractStatus(rawStatus),
    // Resolved link fields — populated downstream by link resolver
    tenant_id:            null,
    unit_id:              null,
    // Private fields for link resolver
    _airtable_tenant_ext_id: tenantExtId,
    _airtable_unit_ext_id:   null,
  };
}
