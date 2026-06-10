/**
 * normalizeMantenimiento — Airtable "Mantenimiento" → incidents table.
 *
 * New base ("Untitled Base", apphwPe2oIkGRSTkb) schema:
 *   Tarea ID [singleLineText], Tipo de tarea [singleSelect],
 *   Prioridad [singleSelect], Estado [singleSelect],
 *   Habitación [singleLineText] (free text, NOT a record link),
 *   Fecha solicitud [date], Fecha completado [date],
 *   Responsable [singleLineText], Costo (S/) [currency],
 *   Descripción [multilineText], Fotos / Evidencia [multipleAttachments]
 *
 * DB constraints (incidents):
 *   category NOT NULL CHECK IN ('plumbing','electrical','appliance','structural','cleaning','other')
 *   title NOT NULL, description NOT NULL
 *   priority NOT NULL CHECK IN ('low','medium','high','urgent')
 *   status NOT NULL CHECK IN ('pending','in_progress','solved')
 *
 * Mantenimiento has NO property/unit record links — Habitación is free text,
 * so unit_id/property_id stay null and the room is recorded in the description.
 */

import type { AirtableRecord } from '@/lib/schemas/airtable';

const FIELD = {
  TASK_ID:     'Tarea ID',
  TASK_TYPE:   'Tipo de tarea',
  PRIORITY:    'Prioridad',
  STATUS:      'Estado',
  ROOM:        'Habitación',
  REQUESTED:   'Fecha solicitud',
  COMPLETED:   'Fecha completado',
  RESPONSIBLE: 'Responsable',
  COST:        'Costo (S/)',
  DESCRIPTION: 'Descripción',
  PHOTOS:      'Fotos / Evidencia',
} as const;

export interface NormalizedIncident {
  org_id: string;
  airtable_external_id: string;
  airtable_synced_at: string;
  title: string;
  description: string;
  category: 'plumbing' | 'electrical' | 'appliance' | 'structural' | 'cleaning' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'solved';
  cost: number | null;
  photo_path: string | null;
  resolved_at: string | null;
}

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : String(v);
  return s.trim() || null;
}

function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

export function mapIncidentCategory(raw: string | null): NormalizedIncident['category'] {
  if (!raw) return 'other';
  const s = raw.toLowerCase();
  if (s.includes('gasfiter') || s.includes('plomer') || s.includes('plumb') || s.includes('agua') || s.includes('tuber')) return 'plumbing';
  if (s.includes('eléctr') || s.includes('electr') || s.includes('luz')) return 'electrical';
  if (s.includes('electrodom') || s.includes('appliance') || s.includes('refriger') || s.includes('lavador')) return 'appliance';
  if (s.includes('estructur') || s.includes('structur') || s.includes('pared') || s.includes('techo')) return 'structural';
  if (s.includes('limpiez') || s.includes('clean')) return 'cleaning';
  return 'other';
}

export function mapIncidentPriority(raw: string | null): NormalizedIncident['priority'] {
  if (!raw) return 'medium';
  const s = raw.toLowerCase();
  if (s.includes('urgent')) return 'urgent';
  if (s.includes('alta') || s.includes('high')) return 'high';
  if (s.includes('baja') || s.includes('low')) return 'low';
  return 'medium';
}

export function mapIncidentStatus(raw: string | null): NormalizedIncident['status'] {
  if (!raw) return 'pending';
  const s = raw.toLowerCase();
  if (s.includes('complet') || s.includes('resuel') || s.includes('solved') || s.includes('termin') || s.includes('cerrad') || s.includes('done')) return 'solved';
  if (s.includes('progres') || s.includes('proceso') || s.includes('curso')) return 'in_progress';
  return 'pending';
}

function extractFirstAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as Record<string, unknown> | undefined;
  const url = first?.['url'];
  return typeof url === 'string' && url ? url : null;
}

export function normalizeMantenimiento(
  record: AirtableRecord,
  orgId: string
): NormalizedIncident {
  const f = record.fields;

  const taskId = toString(f[FIELD.TASK_ID]);
  const taskType = toString(f[FIELD.TASK_TYPE]);
  const room = toString(f[FIELD.ROOM]);
  const responsible = toString(f[FIELD.RESPONSIBLE]);
  const rawDescription = toString(f[FIELD.DESCRIPTION]);

  // title NOT NULL: prefer Tarea ID, then task type, then record id
  const title = taskId ?? taskType ?? `Mantenimiento ${record.id}`;

  // description NOT NULL: compose room + responsible context (no PII concerns —
  // these are operational fields) with the free-text description.
  const parts: string[] = [];
  if (room) parts.push(`Habitación: ${room}`);
  if (responsible) parts.push(`Responsable: ${responsible}`);
  if (rawDescription) parts.push(rawDescription);
  const description = parts.length > 0 ? parts.join('\n') : (taskType ?? '—');

  const completed = toString(f[FIELD.COMPLETED]);

  return {
    org_id: orgId,
    airtable_external_id: record.id,
    airtable_synced_at: new Date().toISOString(),
    title,
    description,
    category: mapIncidentCategory(taskType),
    priority: mapIncidentPriority(toString(f[FIELD.PRIORITY])),
    status: mapIncidentStatus(toString(f[FIELD.STATUS])),
    cost: toNumeric(f[FIELD.COST]),
    photo_path: extractFirstAttachmentUrl(f[FIELD.PHOTOS]),
    resolved_at: completed ? new Date(completed).toISOString() : null,
  };
}
