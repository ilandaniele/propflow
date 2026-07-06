import { describe, it, expect } from 'vitest';
import {
  normalizeMantenimiento,
  mapIncidentCategory,
  mapIncidentPriority,
  mapIncidentStatus,
} from '@/lib/airtable/normalizers/normalizeMantenimiento';
import type { AirtableRecord } from '@/lib/airtable/client';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makeRecord(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, createdTime: '2026-06-10T00:00:00.000Z', fields } as AirtableRecord;
}

describe('normalizeMantenimiento', () => {
  it('maps a complete record', () => {
    const r = normalizeMantenimiento(
      makeRecord('recMANT01', {
        'Tarea ID': 'MANT-001',
        'Tipo de tarea': 'Gasfitería',
        'Prioridad': 'Alta',
        'Estado': 'En progreso',
        'Habitación': 'Hab 101',
        'Fecha completado': '2026-06-01',
        'Responsable': 'Pedro',
        'Costo (S/)': 150.5,
        'Descripción': 'Fuga en el caño',
        'Fotos / Evidencia': [{ url: 'https://cdn.airtable.com/photo.jpg' }],
      }),
      ORG_ID
    );
    expect(r.org_id).toBe(ORG_ID);
    expect(r.airtable_external_id).toBe('recMANT01');
    expect(r.title).toBe('MANT-001');
    expect(r.category).toBe('plumbing');
    expect(r.priority).toBe('high');
    expect(r.status).toBe('in_progress');
    expect(r.cost).toBe(150.5);
    expect(r.photo_path).toBe('https://cdn.airtable.com/photo.jpg');
    expect(r.resolved_at).not.toBeNull();
    expect(r.description).toContain('Habitación: Hab 101');
    expect(r.description).toContain('Responsable: Pedro');
    expect(r.description).toContain('Fuga en el caño');
  });

  it('empty record still satisfies NOT NULL columns (title, description, enums)', () => {
    const r = normalizeMantenimiento(makeRecord('recEMPTY', {}), ORG_ID);
    expect(r.title).toBe('Mantenimiento recEMPTY');
    expect(r.description).toBe('—');
    expect(r.category).toBe('other');
    expect(r.priority).toBe('medium');
    expect(r.status).toBe('pending');
    expect(r.cost).toBeNull();
    expect(r.photo_path).toBeNull();
    expect(r.resolved_at).toBeNull();
  });

  it('reads priority from the live "Urgencia" field', () => {
    const r = normalizeMantenimiento(
      makeRecord('recURG01', {
        'Tarea ID': 'INC-010',
        'Urgencia': 'Urgente',
        'Estado': 'Pendiente',
        'Descripción': 'Sin agua',
      }),
      ORG_ID
    );
    expect(r.priority).toBe('urgent');
    expect(r.title).toBe('INC-010');
    expect(r.description).toContain('Sin agua');
  });

  it('prefers "Urgencia" over the legacy "Prioridad" when both present', () => {
    const r = normalizeMantenimiento(
      makeRecord('recURG02', {
        'Urgencia': 'Baja',
        'Prioridad': 'Alta',
      }),
      ORG_ID
    );
    expect(r.priority).toBe('low');
  });

  it('category keyword mapping', () => {
    expect(mapIncidentCategory('Eléctrico')).toBe('electrical');
    expect(mapIncidentCategory('Limpieza profunda')).toBe('cleaning');
    expect(mapIncidentCategory('Reparación estructural')).toBe('structural');
    expect(mapIncidentCategory('Lavadora rota')).toBe('appliance');
    expect(mapIncidentCategory('Pintura')).toBe('other');
    expect(mapIncidentCategory(null)).toBe('other');
  });

  it('priority mapping with default medium', () => {
    expect(mapIncidentPriority('Urgente')).toBe('urgent');
    expect(mapIncidentPriority('Baja')).toBe('low');
    expect(mapIncidentPriority('Media')).toBe('medium');
    expect(mapIncidentPriority('???')).toBe('medium');
    expect(mapIncidentPriority(null)).toBe('medium');
  });

  it('status mapping emits only CHECK-allowed values', () => {
    expect(mapIncidentStatus('Completado')).toBe('solved');
    expect(mapIncidentStatus('Resuelto')).toBe('solved');
    expect(mapIncidentStatus('En proceso')).toBe('in_progress');
    expect(mapIncidentStatus('Pendiente')).toBe('pending');
    expect(mapIncidentStatus('cualquier cosa')).toBe('pending');
    expect(mapIncidentStatus(null)).toBe('pending');
  });
});
