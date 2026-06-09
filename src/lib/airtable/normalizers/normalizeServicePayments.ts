/**
 * normalizeServicePayment — server-only.
 *
 * Maps raw Airtable records from the 4 "Pago de servicios" tables
 * (agua, internet, gas, luz) to a normalised shape ready for the
 * service_payments domain table.
 *
 * Design: pure function, no side effects, no DB calls.
 * AC9: read-only toward Airtable — never issues HTTP calls.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceType = 'agua' | 'internet' | 'gas' | 'luz';

export type MonthEntry = {
  amount: number | null;
  eecc: string | null;
  receipt_url: string | null;
};

export type NormalizedServicePayment = {
  org_id: string;
  airtable_external_id: string;
  airtable_synced_at: string;
  service_type: ServiceType;
  supply_number: string | null;
  tope?: number | null;
  monthly_data: Record<string, MonthEntry>;
  // Private helper for link resolution — stripped by toDbRow() before upsert
  _airtable_property_ext_id: string | null;
};

// ---------------------------------------------------------------------------
// Monthly data parser
// ---------------------------------------------------------------------------

/**
 * Scan all field keys for amount columns matching "Monto MM - YY <suffix>"
 * and build a { "20YY-MM": { amount, eecc, receipt_url } } record.
 *
 * @param fields        Raw Airtable record fields
 * @param amountSuffix  Letter suffix e.g. "A", "I", "G", "L"
 * @param eeccPrefix    Column prefix for EECC (e.g. "EECC"), or null if not present
 * @param receiptSuffix Suffix letter for Const. column (same as amountSuffix)
 */
export function parseMonthlyData(
  fields: Record<string, unknown>,
  amountSuffix: string,
  eeccPrefix: string | null,
  receiptSuffix: string,
): Record<string, MonthEntry> {
  const result: Record<string, MonthEntry> = {};

  for (const key of Object.keys(fields)) {
    // Match "Monto MM - YY" (with optional extra text like " agua" at the end)
    const amountMatch = key.match(/^Monto\s+(\d{2})\s*-\s*(\d{2})/i);
    if (!amountMatch) continue;

    // Filter to columns that belong to this service type by checking the suffix
    // letter appears in the key (e.g. "(A)" in "Monto 01 - 26 (A) agua")
    const suffixToken = `(${amountSuffix})`;
    if (!key.includes(suffixToken)) continue;

    // Skip Airtable view-generated duplicate columns (e.g. "Monto 01 - 26 (A) copy").
    // These share the same suffix token but would overwrite the canonical column value.
    const keyLower = key.toLowerCase();
    if (keyLower.includes('copy')) continue;

    const mm = amountMatch[1];
    const yy = amountMatch[2];
    const monthKey = `20${yy}-${mm}`;

    const rawAmount = fields[key];
    let amount: number | null = null;
    if (rawAmount !== null && rawAmount !== undefined && rawAmount !== '') {
      const parsed = parseFloat(String(rawAmount));
      amount = isNaN(parsed) ? null : parsed;
    }

    // EECC column: "EECC MM - YY"
    const eeccKey = eeccPrefix ? `${eeccPrefix} ${mm} - ${yy}` : null;
    const eeccRaw = eeccKey ? fields[eeccKey] : null;
    const eecc = typeof eeccRaw === 'string' && eeccRaw.trim() ? eeccRaw.trim() : null;

    // Receipt/Constancia column: "Const. MM - YY (suffix)"
    const receiptKey = `Const. ${mm} - ${yy} (${receiptSuffix})`;
    const receiptRaw = fields[receiptKey];
    let receipt_url: string | null = null;
    if (Array.isArray(receiptRaw) && receiptRaw.length > 0) {
      receipt_url = (receiptRaw[0] as { url?: string }).url ?? null;
    } else if (typeof receiptRaw === 'string' && receiptRaw.trim()) {
      receipt_url = receiptRaw.trim();
    }

    if (amount !== null || eecc !== null || receipt_url !== null) {
      result[monthKey] = { amount, eecc, receipt_url };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// normalizeServicePayment
// ---------------------------------------------------------------------------

/**
 * Transform a raw Airtable record from one of the 4 Pago de servicios tables
 * into a NormalizedServicePayment ready for DB upsert.
 *
 * @param record       Raw AirtableRecord from the Airtable REST API
 * @param orgId        Organization UUID
 * @param serviceType  'agua' | 'internet' | 'gas' | 'luz'
 */
export function normalizeServicePayment(
  record: AirtableRecord,
  orgId: string,
  serviceType: ServiceType,
): NormalizedServicePayment {
  const f = record.fields as Record<string, unknown>;

  // Linked property record
  const propertyLinks = Array.isArray(f['Propiedad']) ? f['Propiedad'] : [];
  const _airtable_property_ext_id =
    (propertyLinks as Array<{ id?: string } | string>)[0] != null
      ? typeof (propertyLinks as Array<{ id?: string } | string>)[0] === 'string'
        ? ((propertyLinks as string[])[0] ?? null)
        : ((propertyLinks as Array<{ id?: string }>)[0]?.id ?? null)
      : null;

  let supply_number: string | null = null;
  let tope: number | null = null;
  let monthly_data: Record<string, MonthEntry> = {};

  switch (serviceType) {
    case 'agua': {
      const raw = f['N° de suministro (A)'];
      supply_number = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      monthly_data = parseMonthlyData(f, 'A', 'EECC', 'A');
      break;
    }
    case 'internet': {
      const raw = f['Código de pago (I)'];
      supply_number = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      monthly_data = parseMonthlyData(f, 'I', null, 'I');
      break;
    }
    case 'gas': {
      const raw = f['N° de cliente (G)'];
      supply_number = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      monthly_data = parseMonthlyData(f, 'G', null, 'G');
      break;
    }
    case 'luz': {
      const rawSuministro = f['N° de suministro (L)'];
      supply_number = typeof rawSuministro === 'string' && rawSuministro.trim() ? rawSuministro.trim() : null;
      const rawTope = f['Tope'];
      if (rawTope !== null && rawTope !== undefined && rawTope !== '') {
        const parsed = parseFloat(String(rawTope));
        tope = isNaN(parsed) ? null : parsed;
      }
      monthly_data = parseMonthlyData(f, 'L', null, 'L');
      break;
    }
  }

  const base: NormalizedServicePayment = {
    org_id: orgId,
    airtable_external_id: `${record.id}::${serviceType}`,
    airtable_synced_at: new Date().toISOString(),
    service_type: serviceType,
    supply_number,
    monthly_data,
    _airtable_property_ext_id,
  };

  if (serviceType === 'luz') {
    base.tope = tope;
  }

  return base;
}
