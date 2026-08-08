import { describe, it, expect } from 'vitest';
import { normalizeTrashSchedule } from '@/lib/airtable/normalizers/normalizeTrashSchedule';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const ORG = '00000000-0000-0000-0000-000000000001';
const rec = (fields: Record<string, unknown>, id = 'recTS1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeTrashSchedule', () => {
  it('joins a multi-value "Día" array and extracts linked ids', () => {
    const r = normalizeTrashSchedule(rec({
      'Name': 'Turno A', 'Zona': 'Piso 1', 'Día': ['Lunes', 'Miércoles'],
      'Residente': ['recTEN1'], 'Habitacion': ['recUNIT1'],
    }), ORG);
    expect(r).toMatchObject({
      org_id: ORG, airtable_external_id: 'recTS1', name: 'Turno A', zona: 'Piso 1',
      dias: 'Lunes, Miércoles',
      _airtable_tenant_ext_id: 'recTEN1', _airtable_unit_ext_id: 'recUNIT1',
    });
  });

  it('activo is true for boolean true OR numeric 1, else false', () => {
    expect(normalizeTrashSchedule(rec({ 'Activo': true }), ORG).activo).toBe(true);
    expect(normalizeTrashSchedule(rec({ 'Activo': 1 }), ORG).activo).toBe(true);
    expect(normalizeTrashSchedule(rec({ 'Activo': 'sí' }), ORG).activo).toBe(false);
    expect(normalizeTrashSchedule(rec({}), ORG).activo).toBe(false);
  });

  it('turnosExtra keeps only numeric values (else null)', () => {
    expect(normalizeTrashSchedule(rec({ 'Turnos extra': 2 }), ORG).turnos_extra).toBe(2);
    expect(normalizeTrashSchedule(rec({ 'Turnos extra': '2' }), ORG).turnos_extra).toBeNull();
    expect(normalizeTrashSchedule(rec({}), ORG).turnos_extra).toBeNull();
  });
});
