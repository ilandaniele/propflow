/**
 * normalizeServicePayments — server-only.
 *
 * New base schema: the 4 separate service payment tables (agua/internet/gas/luz)
 * have been consolidated into a SINGLE "Pago de servicios" table.
 *
 * Each Airtable record = one monthly payment of one service type for one property.
 * The DB model is: one row per (property, service_type), with monthly_data JSONB
 * accumulating entries keyed "YYYY-MM".
 *
 * Exported:
 *   normalizeServicePaymentRecord — normalize one Airtable record
 *   aggregateServicePaymentRecords — group multiple records → one row per (property, service)
 *
 * Design: pure functions, no side effects, no DB calls.
 * AC9: read-only toward Airtable — these functions never issue any HTTP call.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';
import { extractFirstLinkedId } from '@/lib/airtable/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceType = 'agua' | 'luz' | 'gas' | 'internet' | 'otro';

export type MonthEntry = {
  amount: number | null;
  eecc: string | null;
  receipt_url: string | null;
};

export type NormalizedServicePayment = {
  org_id: string;
  airtable_external_id: string;   // synthetic: "${propertyRecId}::${serviceType}"
  airtable_synced_at: string;
  service_type: ServiceType;
  supply_number: string | null;
  tope: number | null;
  monthly_data: Record<string, MonthEntry>;
  // Private helper for link resolution — stripped by toDbRow() before upsert
  _airtable_property_ext_id: string | null;
};

// ---------------------------------------------------------------------------
// Field name constants (match Airtable column names in "Pago de servicios")
// ---------------------------------------------------------------------------

const SERVICE_FIELD = {
  TIPO:       'Tipo de servicio',
  MES:        'Mes',
  AÑO:        'Año',
  MONTO:      'Monto (S/)',
  TOPE:       'Tope (S/) auto',
  ESTADO:     'Estado',
  CONSTANCIA: 'Constancia',       // attachment
  PROPIEDAD:  'Propiedad',        // linked record
} as const;

// ---------------------------------------------------------------------------
// Service type token mapping
// ---------------------------------------------------------------------------

/**
 * Map a raw "Tipo de servicio" select value to a canonical ServiceType token.
 * Matching is substring-based (case-insensitive) for resilience.
 */
export function mapServiceType(raw: unknown): ServiceType {
  if (typeof raw !== 'string') return 'otro';
  const lower = raw.toLowerCase();
  if (lower.includes('agua'))                        return 'agua';
  if (lower.includes('luz') || lower.includes('eléctr') || lower.includes('electr')) return 'luz';
  if (lower.includes('gas'))                         return 'gas';
  if (lower.includes('internet') || lower.includes('wifi')) return 'internet';
  return 'otro';
}

// ---------------------------------------------------------------------------
// Spanish month → MM mapping (same as normalizePayment)
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
 * Build a "YYYY-MM" key from the Mes + Año select values.
 * If month is unparseable, returns a raw "${año}-${mes}" key so data isn't lost.
 */
export function buildServiceMonthKey(mes: unknown, año: unknown): string {
  const mesStr = typeof mes === 'string' ? mes.trim().toLowerCase() : '';
  const añoStr = typeof año === 'string' ? año.trim() : '';

  let mm: string | null = null;

  // Numeric month (e.g. "1", "01", "12")
  const mesNum = parseInt(mesStr, 10);
  if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
    mm = String(mesNum).padStart(2, '0');
  } else {
    // Direct Spanish/English lookup
    mm = MONTH_MAP[mesStr] ?? null;
    if (!mm) {
      // Prefix match (e.g. "ene" → "enero")
      for (const [name, num] of Object.entries(MONTH_MAP)) {
        if (name.startsWith(mesStr.substring(0, 3)) && mesStr.length >= 3) {
          mm = num;
          break;
        }
      }
    }
  }

  if (!mm) {
    // Return raw concatenation — unparseable but not silently dropped
    return `${añoStr || '????'}-${mesStr || '??'}`;
  }

  return `${añoStr || '????'}-${mm}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// normalizeServicePaymentRecord — one Airtable record → intermediate shape
// ---------------------------------------------------------------------------

export interface ServicePaymentIntermediate {
  propertyExtId: string | null;
  serviceType: ServiceType;
  monthKey: string;
  entry: MonthEntry;
  tope: number | null;
}

/**
 * Extract the data fields from a single Airtable "Pago de servicios" record.
 * Returns an intermediate shape; use aggregateServicePaymentRecords() to
 * fold multiple intermediates into the final NormalizedServicePayment rows.
 */
export function normalizeServicePaymentRecord(
  record: AirtableRecord,
): ServicePaymentIntermediate {
  const f = record.fields as Record<string, unknown>;

  const propertyExtId = extractFirstLinkedId(f[SERVICE_FIELD.PROPIEDAD]);
  const serviceType   = mapServiceType(f[SERVICE_FIELD.TIPO]);
  const monthKey      = buildServiceMonthKey(f[SERVICE_FIELD.MES], f[SERVICE_FIELD.AÑO]);
  const tope          = toNumeric(f[SERVICE_FIELD.TOPE]);

  const entry: MonthEntry = {
    amount:      toNumeric(f[SERVICE_FIELD.MONTO]),
    eecc:        typeof f[SERVICE_FIELD.ESTADO] === 'string' ? (f[SERVICE_FIELD.ESTADO] as string).trim() || null : null,
    receipt_url: extractFirstAttachmentUrl(f[SERVICE_FIELD.CONSTANCIA]),
  };

  return { propertyExtId, serviceType, monthKey, entry, tope };
}

// ---------------------------------------------------------------------------
// aggregateServicePaymentRecords — fold many records → one row per (prop, svc)
// ---------------------------------------------------------------------------

/**
 * Process all Airtable "Pago de servicios" records for one org and produce
 * the final NormalizedServicePayment rows (one per property+serviceType pair).
 *
 * The monthly_data map is built fresh from all records — a full replace per
 * sync run is correct and simpler than a merge against existing DB rows.
 * The synthetic airtable_external_id = "${propertyRecId}::${serviceType}" must
 * match the unique index (org_id, airtable_external_id) on service_payments.
 *
 * @param records   All Airtable records from the "Pago de servicios" table
 * @param orgId     Organization UUID
 */
export function aggregateServicePaymentRecords(
  records: AirtableRecord[],
  orgId: string,
): NormalizedServicePayment[] {
  // Intermediate grouping: key = "${propertyExtId}::${serviceType}"
  const grouped = new Map<string, {
    propertyExtId: string;
    serviceType: ServiceType;
    monthly_data: Record<string, MonthEntry>;
    tope: number | null;
  }>();

  for (const record of records) {
    const { propertyExtId, serviceType, monthKey, entry, tope } =
      normalizeServicePaymentRecord(record);

    if (!propertyExtId) {
      // Cannot assign to a property — skip
      continue;
    }

    const groupKey = `${propertyExtId}::${serviceType}`;
    const existing = grouped.get(groupKey);

    if (existing) {
      // Merge month entry; later records overwrite earlier for the same month
      existing.monthly_data[monthKey] = entry;
      // Keep the most recent non-null tope
      if (tope !== null) existing.tope = tope;
    } else {
      grouped.set(groupKey, {
        propertyExtId,
        serviceType,
        monthly_data: { [monthKey]: entry },
        tope,
      });
    }
  }

  const now = new Date().toISOString();
  const result: NormalizedServicePayment[] = [];

  for (const [groupKey, group] of grouped) {
    result.push({
      org_id:               orgId,
      airtable_external_id: groupKey,   // "${propertyRecId}::${serviceType}"
      airtable_synced_at:   now,
      service_type:         group.serviceType,
      supply_number:        null,        // supply numbers live on properties, not individual payment rows
      tope:                 group.tope,
      monthly_data:         group.monthly_data,
      _airtable_property_ext_id: group.propertyExtId,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Legacy re-export — kept so any import of `normalizeServicePayment` doesn't break.
// The 4-type variant is no longer used by the cron but may exist in older tests.
// Delegates to the new single-record normalizer with a best-effort mapping.
// ---------------------------------------------------------------------------

/** @deprecated Use aggregateServicePaymentRecords() instead */
export function normalizeServicePayment(
  record: AirtableRecord,
  orgId: string,
  serviceType: ServiceType,
): NormalizedServicePayment {
  const f = record.fields as Record<string, unknown>;
  const propertyExtId = extractFirstLinkedId(f['Propiedad']);
  const monthKey = buildServiceMonthKey(f['Mes'], f['Año']);
  const entry: MonthEntry = {
    amount:      toNumeric(f['Monto (S/)']),
    eecc:        typeof f['Estado'] === 'string' ? (f['Estado'] as string).trim() || null : null,
    receipt_url: extractFirstAttachmentUrl(f['Constancia']),
  };
  return {
    org_id:               orgId,
    airtable_external_id: `${record.id}::${serviceType}`,
    airtable_synced_at:   new Date().toISOString(),
    service_type:         serviceType,
    supply_number:        null,
    tope:                 toNumeric(f['Tope (S/) auto']),
    monthly_data:         { [monthKey]: entry },
    _airtable_property_ext_id: propertyExtId,
  };
}
