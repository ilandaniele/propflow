import type { AirtableRecord } from '@/lib/schemas/airtable';

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

function toDate(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null;
  return v.slice(0, 10) || null;
}

export function normalizeAbsence(record: AirtableRecord, orgId: string): Record<string, unknown> {
  const f = record.fields;

  const residenteLinks = f['Residente'];
  const _airtable_tenant_ext_id = Array.isArray(residenteLinks) && residenteLinks.length > 0
    ? String(residenteLinks[0]) : null;

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f['Name']),
    fecha_inicio:         toDate(f['Fecha inicio']),
    fecha_fin:            toDate(f['Fecha fin']),
    estado:               toString(f['Estado']),
    registrado:           toString(f['Registrado']),
    motivo:               toString(f['Motivo']),
    _airtable_tenant_ext_id,
  };
}
