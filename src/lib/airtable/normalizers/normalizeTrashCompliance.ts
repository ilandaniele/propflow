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

function toTimestamp(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null;
  return v || null;
}

export function normalizeTrashCompliance(record: AirtableRecord, orgId: string): Record<string, unknown> {
  const f = record.fields;

  const turnoLinks = f['Turno'];
  const _airtable_trash_schedule_ext_id = Array.isArray(turnoLinks) && turnoLinks.length > 0
    ? String(turnoLinks[0]) : null;

  const residenteLinks = f['Residente'];
  const _airtable_tenant_ext_id = Array.isArray(residenteLinks) && residenteLinks.length > 0
    ? String(residenteLinks[0]) : null;

  // First photo URL from attachments
  let fotoUrl: string | null = null;
  const fotos = f['Foto'];
  if (Array.isArray(fotos) && fotos.length > 0) {
    const first = fotos[0] as { url?: string };
    fotoUrl = toString(first?.url);
  }

  return {
    org_id:               orgId,
    airtable_external_id: record.id,
    airtable_synced_at:   new Date().toISOString(),
    name:                 toString(f['Name']),
    fecha:                toDate(f['Fecha']),
    estado:               toString(f['Estado']),
    foto_url:             fotoUrl,
    hora_confirmacion:    toTimestamp(f['Hora confirmación']),
    hash_imagen:          toString(f['Hash Imagen']),
    _airtable_trash_schedule_ext_id,
    _airtable_tenant_ext_id,
  };
}
