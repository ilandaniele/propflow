/**
 * normalizePayment — server-only.
 *
 * Maps a raw Airtable record from the Pagos table to a NormalizedPayment
 * ready to be upserted into public.payments.
 *
 * "Renta (from ID)" and "Fecha de pago (from ID)" are rollup fields that Airtable
 * returns as arrays (linked rollup). We extract and parse the first element.
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';
import type { NormalizedPayment } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Pagos table)
// ---------------------------------------------------------------------------

export const PAYMENT_FIELD = {
  NAME:         'Name',
  TENANT_NAME:  'Nombre(s) y apellidos',
  PHONE:        'Número celular',
  AMOUNT:       'Renta (from ID)',          // linked rollup — array or scalar
  DUE_DATE:     'Fecha de pago (from ID)',  // linked rollup — array or scalar
  PERIOD_MONTH: 'Mes actual',
} as const;

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * Parse a rollup field that may be an array (Airtable linked rollup) or a scalar.
 * Extracts the first element and coerces to number.
 */
function parseRollupNumeric(v: unknown): number | null {
  if (Array.isArray(v)) {
    return v.length > 0 ? toNumeric(v[0]) : null;
  }
  return toNumeric(v);
}

/**
 * Parse a rollup field that may be an array or a scalar date string.
 */
function parseRollupDate(v: unknown): string | null {
  if (Array.isArray(v)) {
    return v.length > 0 ? toString(v[0]) : null;
  }
  return toString(v);
}

// ---------------------------------------------------------------------------
// normalizePayment
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable Pagos record into a NormalizedPayment.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 * @returns       NormalizedPayment; contract_id/tenant_id remain null (set by link resolver)
 */
export function normalizePayment(
  record: AirtableRecord,
  orgId: string
): NormalizedPayment {
  const f = record.fields;

  // Extract linked record id for the contract (if present as a linked-record array)
  const contractExtId = extractFirstLinkedId(f['ID']);

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f[PAYMENT_FIELD.NAME]),
    tenant_name:          toString(f[PAYMENT_FIELD.TENANT_NAME]),
    phone:                toString(f[PAYMENT_FIELD.PHONE]),
    amount:               parseRollupNumeric(f[PAYMENT_FIELD.AMOUNT]),
    due_date:             parseRollupDate(f[PAYMENT_FIELD.DUE_DATE]),
    paid_at:              null,   // Airtable Pagos has no "paid at" field; preserves DB value via upsert
    period_month:         toString(f[PAYMENT_FIELD.PERIOD_MONTH]),
    // Resolved link fields — populated downstream by link resolver
    contract_id:          null,
    tenant_id:            null,
    // Private fields for link resolver
    _airtable_contract_ext_id: contractExtId,
    _airtable_tenant_ext_id:   null,
  };
}
