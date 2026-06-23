import type { AirtableRecord } from '@/lib/schemas/airtable';

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return String(v).trim() || null;
}

export function normalizeTrashSchedule(record: AirtableRecord, orgId: string): Record<string, unknown> {
  const f = record.fields;

  const dias = Array.isArray(f['Día']) ? (f['Día'] as string[]).join(', ') : toString(f['Día']);
  const activo = f['Activo'] === true || f['Activo'] === 1;
  const turnosExtra = typeof f['Turnos extra'] === 'number' ? f['Turnos extra'] : null;

  // First linked record IDs for FK resolution downstream
  const residenteLinks = f['Residente'];
  const _airtable_tenant_ext_id = Array.isArray(residenteLinks) && residenteLinks.length > 0
    ? String(residenteLinks[0]) : null;

  const habitacionLinks = f['Habitacion'];
  const _airtable_unit_ext_id = Array.isArray(habitacionLinks) && habitacionLinks.length > 0
    ? String(habitacionLinks[0]) : null;

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f['Name']),
    zona:                 toString(f['Zona']),
    dias:                 dias,
    activo:               activo,
    turnos_extra:         turnosExtra,
    // FK resolution placeholders — overwritten in buildDomainRow
    _airtable_tenant_ext_id,
    _airtable_unit_ext_id,
  };
}
