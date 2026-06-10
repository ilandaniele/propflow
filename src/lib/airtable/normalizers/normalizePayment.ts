/**
 * normalizePayment — server-only.
 *
 * Maps a raw Airtable record from the Movimientos table (new base schema — was Pagos)
 * to a NormalizedPayment ready to be upserted into public.payments.
 *
 * Key differences from old Pagos schema:
 * - Table is now "Movimientos" (env key AIRTABLE_TABLE_PAGOS still points to it)
 * - Contract link field is "📋 Historial (Contratos)" (WITH the emoji prefix — exact match)
 * - Amount: Monto depositado (S/) with fallback to Monto renta (S/)
 * - Due date: Fecha de vencimiento; paid date: Fecha de pago
 * - paid_at is NOT NULL in DB — fall back to due_date if Fecha de pago empty
 * - Period: Mes + Año select values (Spanish month names parsed to YYYY-MM)
 * - Status mapped from Estado pago
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — this function never issues any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';
import type { NormalizedPayment } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in the Movimientos table)
// ---------------------------------------------------------------------------

export const PAYMENT_FIELD = {
  // Contract link — EXACT name with emoji
  CONTRACT_LINK:    '📋 Historial (Contratos)',
  // Tenant name lookup (display value, not record id)
  TENANT_NAME:      'Nombres y Apellidos',
  // Dates
  DUE_DATE:         'Fecha de vencimiento',
  PAID_DATE:        'Fecha de pago',
  // Amounts — primary then fallback
  AMOUNT_DEPOSITED: 'Monto depositado (S/)',
  AMOUNT_RENT:      'Monto renta (S/)',
  // Period
  MES:              'Mes',
  AÑO:              'Año',
  // Payment method
  METHOD:           'Método de pago',
  // Status
  STATUS:           'Estado pago',
  // Receipt attachment
  RECEIPT:          'Comprobante',
} as const;

// ---------------------------------------------------------------------------
// Spanish month → MM mapping
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, string> = {
  enero:      '01', january:    '01',
  febrero:    '02', february:   '02',
  marzo:      '03', march:      '03',
  abril:      '04', april:      '04',
  mayo:       '05', may:        '05',
  junio:      '06', june:       '06',
  julio:      '07', july:       '07',
  agosto:     '08', august:     '08',
  septiembre: '09', september:  '09', setiembre: '09',
  octubre:    '10', october:    '10',
  noviembre:  '11', november:   '11',
  diciembre:  '12', december:   '12',
};

/**
 * Build a "YYYY-MM" period key from the Mes + Año select values.
 * Mes can be a Spanish month name (e.g. "Enero"), a numeric string ("01"), or a
 * label like "Enero 2026". Año is typically a 4-digit year string ("2026").
 * Returns null if either value is unparseable.
 */
export function buildPeriodMonth(mes: unknown, año: unknown): string | null {
  const mesStr = typeof mes === 'string' ? mes.trim().toLowerCase() : null;
  const añoStr = typeof año === 'string' ? año.trim() : null;

  if (!mesStr || !añoStr) return null;

  // Try numeric month first (e.g. "01", "1", "12")
  let mm: string | null = null;
  const mesNum = parseInt(mesStr, 10);
  if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
    mm = String(mesNum).padStart(2, '0');
  } else {
    // Try full Spanish/English name or prefix match
    for (const [name, num] of Object.entries(MONTH_MAP)) {
      if (mesStr.startsWith(name) || name.startsWith(mesStr.substring(0, 3))) {
        mm = num;
        break;
      }
    }
    // Direct lookup (e.g. "enero" exact)
    if (!mm) mm = MONTH_MAP[mesStr] ?? null;
  }

  if (!mm) {
    // Cannot parse month — return raw concatenation so data isn't silently dropped
    return `${añoStr}-${mesStr}`;
  }

  // Validate year looks like a 4-digit number
  const yearNum = parseInt(añoStr, 10);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2099) {
    return `${añoStr}-${mm}`;
  }

  return `${añoStr}-${mm}`;
}

// ---------------------------------------------------------------------------
// Payment method mapping
// ---------------------------------------------------------------------------

const METHOD_MAP: Record<string, string> = {
  efectivo:       'cash',
  cash:           'cash',
  'transferencia': 'transfer',
  transfer:       'transfer',
  yape:           'transfer',
  plin:           'transfer',
  deposito:       'transfer',
  depósito:       'transfer',
  tarjeta:        'card',
  card:           'card',
  crédito:        'card',
  credito:        'card',
  débito:         'card',
  debito:         'card',
};

export function mapPaymentMethod(raw: string | null | undefined): string {
  if (!raw) return 'transfer'; // default
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(METHOD_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 'transfer'; // safe default
}

// ---------------------------------------------------------------------------
// Payment status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  pagado:   'approved',
  completo: 'approved',
  paid:     'approved',
  approved: 'approved',
  aprobado: 'approved',
};

export function mapPaymentStatus(raw: string | null | undefined): string {
  if (!raw) return 'pending';
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(STATUS_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 'pending';
}

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

function extractFirstAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const url = first['url'];
  return typeof url === 'string' && url ? url : null;
}

// ---------------------------------------------------------------------------
// normalizePayment
// ---------------------------------------------------------------------------

export type NormalizePaymentResult =
  | { skip: true; reason: string; record: AirtableRecord }
  | { skip: false; payment: NormalizedPayment };

/**
 * Transform a raw Airtable Movimientos record into a NormalizedPayment.
 *
 * Returns { skip: true, reason } when the row cannot satisfy DB NOT NULL
 * constraints (amount <= 0, or both due_date and paid_date missing,
 * or contract link unresolvable). Callers should log and skip these records.
 *
 * @param record  Raw AirtableRecord from the Airtable REST API
 * @param orgId   Organization UUID
 */
export function normalizePayment(
  record: AirtableRecord,
  orgId: string
): NormalizePaymentResult {
  const f = record.fields;

  // ── Amount ────────────────────────────────────────────────────────────────
  // Primary: Monto depositado (S/); fallback: Monto renta (S/)
  let amount = toNumeric(f[PAYMENT_FIELD.AMOUNT_DEPOSITED]);
  if (amount === null || amount <= 0) {
    amount = toNumeric(f[PAYMENT_FIELD.AMOUNT_RENT]);
  }
  if (amount === null || amount <= 0) {
    return {
      skip: true,
      reason: `amount missing or <= 0 (Monto depositado=${f[PAYMENT_FIELD.AMOUNT_DEPOSITED]}, Monto renta=${f[PAYMENT_FIELD.AMOUNT_RENT]})`,
      record,
    };
  }

  // ── Dates ─────────────────────────────────────────────────────────────────
  // paid_at is NOT NULL in DB — fall back to due_date
  const dueDate  = toString(f[PAYMENT_FIELD.DUE_DATE]);
  const paidDate = toString(f[PAYMENT_FIELD.PAID_DATE]);

  const paidAt = paidDate ?? dueDate;
  if (!paidAt) {
    return {
      skip: true,
      reason: 'both Fecha de pago and Fecha de vencimiento are empty — cannot satisfy paid_at NOT NULL',
      record,
    };
  }

  // ── Contract link ─────────────────────────────────────────────────────────
  // "📋 Historial (Contratos)" — exact field name including emoji
  const contractExtId = extractFirstLinkedId(f[PAYMENT_FIELD.CONTRACT_LINK]);

  // ── Period month ──────────────────────────────────────────────────────────
  const periodMonth = buildPeriodMonth(f[PAYMENT_FIELD.MES], f[PAYMENT_FIELD.AÑO]);

  return {
    skip: false,
    payment: {
      org_id:               orgId,
      airtable_external_id: record.id,
      airtable_synced_at:   new Date().toISOString(),
      amount,
      due_date:             dueDate,
      paid_at:              paidAt,
      method:               mapPaymentMethod(toString(f[PAYMENT_FIELD.METHOD])),
      status:               mapPaymentStatus(toString(f[PAYMENT_FIELD.STATUS])),
      period_month:         periodMonth,
      receipt_url:          extractFirstAttachmentUrl(f[PAYMENT_FIELD.RECEIPT]),
      tenant_name:          toString(f[PAYMENT_FIELD.TENANT_NAME]),
      // Resolved link fields — populated downstream
      contract_id:          null,
      tenant_id:            null,
      // Private fields for link resolver
      _airtable_contract_ext_id: contractExtId,
      _airtable_tenant_ext_id:   null,
    },
  };
}
