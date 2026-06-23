import type { AirtableRecord } from '@/lib/schemas/airtable';

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

export function normalizeDepositAccount(record: AirtableRecord, orgId: string): Record<string, unknown> {
  const f = record.fields;
  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f['Name']),
    banco:                toString(f['Banco']),
    tipo_cuenta:          toString(f['Tipo de cuenta']),
    moneda:               toString(f['Moneda']),
    numero_cuenta:        toString(f['N° de cuenta']),
    cci:                  toString(f['CCI']),
  };
}
