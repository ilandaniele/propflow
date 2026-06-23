import type { AirtableRecord } from '@/lib/schemas/airtable';

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

export function normalizeOwner(record: AirtableRecord, orgId: string): Record<string, unknown> {
  const f = record.fields;
  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f['Name']),
    dni:                  toString(f['N° DNI']),
    phone:                toString(f['Número celular']),
    email:                toString(f['Correo electrónico']),
    co_owner_name:        toString(f['Propietario #2']),
    co_owner_dni:         toString(f['N° DNI #2']),
    co_owner_phone:       toString(f['Número celular #2']),
    co_owner_email:       toString(f['Correo electrónico #2']),
    mancomunacion:        toString(f['Mancomunación']),
    apoderamiento:        toString(f['Apoderamiento']),
    domicilio:            toString(f['Domicilio']),
    distrito:             toString(f['Distrito']),
  };
}
