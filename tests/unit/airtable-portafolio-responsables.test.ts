/**
 * Unit tests for normalizePortafolio and normalizeResponsable.
 *
 * Pure function tests — no DB, no HTTP calls.
 */

import { describe, it, expect } from 'vitest';
import { normalizePortafolio } from '@/lib/airtable/normalizers/normalizePortafolio';
import { normalizeResponsable } from '@/lib/airtable/normalizers/normalizeResponsable';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makeRecord(id: string, fields: Record<string, unknown>) {
  return { id, createdTime: '2024-01-01T00:00:00.000Z', fields };
}

// ===========================================================================
// normalizePortafolio
// ===========================================================================

describe('normalizePortafolio', () => {
  it('happy path: maps all fields correctly from a complete record', () => {
    const record = makeRecord('recUNIT001', {
      'N° Habitación': 'Hab. 1',          // new schema field name
      'Propiedad':     [{ id: 'recPROP001' }],
      'Baño':          'Privado',
      'm2':            25.5,
      'Estado':        'Disponible',
    });

    const result = normalizePortafolio(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recUNIT001');
    expect(result.label).toBe('Hab. 1');
    expect(result.toilet_type).toBe('private');
    expect(result.area_m2).toBe(25.5);
    expect(result.status).toBe('vacant');
    expect(result._airtable_property_ext_id).toBe('recPROP001');
    expect(result.airtable_synced_at).toBeTruthy();
  });

  it('Baño "Privado" → toilet_type "private"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Baño': 'Privado' }), ORG_ID);
    expect(result.toilet_type).toBe('private');
  });

  it('Baño "Private" (English) → toilet_type "private"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Baño': 'Private' }), ORG_ID);
    expect(result.toilet_type).toBe('private');
  });

  it('Baño "Compartido" → toilet_type "shared"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Baño': 'Compartido' }), ORG_ID);
    expect(result.toilet_type).toBe('shared');
  });

  it('Baño "Shared" (English) → toilet_type "shared"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Baño': 'Shared' }), ORG_ID);
    expect(result.toilet_type).toBe('shared');
  });

  it('Baño unknown value → toilet_type null', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Baño': 'Otro' }), ORG_ID);
    expect(result.toilet_type).toBeNull();
  });

  it('Baño missing → toilet_type null', () => {
    const result = normalizePortafolio(makeRecord('r1', {}), ORG_ID);
    expect(result.toilet_type).toBeNull();
  });

  it('Estado "Disponible" → status "available"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Disponible' }), ORG_ID);
    expect(result.status).toBe('vacant');
  });

  it('Estado "Available" (English) → status "available"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Available' }), ORG_ID);
    expect(result.status).toBe('vacant');
  });

  it('Estado "Ocupado" → status "occupied"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Ocupado' }), ORG_ID);
    expect(result.status).toBe('occupied');
  });

  it('Estado "Occupied" (English) → status "occupied"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Occupied' }), ORG_ID);
    expect(result.status).toBe('occupied');
  });

  it('Estado "Mantenimiento" → status "maintenance"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Mantenimiento' }), ORG_ID);
    expect(result.status).toBe('vacant');
  });

  it('Estado "Maintenance" (English) → status "maintenance"', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Maintenance' }), ORG_ID);
    expect(result.status).toBe('vacant');
  });

  it('Estado unknown → status vacant (DB default)', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Estado': 'Pendiente' }), ORG_ID);
    expect(result.status).toBe('vacant');
  });

  it('m2 numeric 25.5 → area_m2 25.5', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'm2': 25.5 }), ORG_ID);
    expect(result.area_m2).toBe(25.5);
  });

  it('m2 string "25.5" → area_m2 25.5', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'm2': '25.5' }), ORG_ID);
    expect(result.area_m2).toBe(25.5);
  });

  it('m2 empty string → area_m2 null', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'm2': '' }), ORG_ID);
    expect(result.area_m2).toBeNull();
  });

  it('m2 NaN string → area_m2 null', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'm2': 'abc' }), ORG_ID);
    expect(result.area_m2).toBeNull();
  });

  it('m2 missing → area_m2 null', () => {
    const result = normalizePortafolio(makeRecord('r1', {}), ORG_ID);
    expect(result.area_m2).toBeNull();
  });

  it('Propiedad linked array → _airtable_property_ext_id = first element id', () => {
    const result = normalizePortafolio(
      makeRecord('r1', { 'Propiedad': [{ id: 'recPROP999' }, { id: 'recPROP888' }] }),
      ORG_ID
    );
    expect(result._airtable_property_ext_id).toBe('recPROP999');
  });

  it('Propiedad plain string array → _airtable_property_ext_id = first string', () => {
    const result = normalizePortafolio(
      makeRecord('r1', { 'Propiedad': ['recPROP777'] }),
      ORG_ID
    );
    expect(result._airtable_property_ext_id).toBe('recPROP777');
  });

  it('Propiedad empty array → _airtable_property_ext_id null', () => {
    const result = normalizePortafolio(makeRecord('r1', { 'Propiedad': [] }), ORG_ID);
    expect(result._airtable_property_ext_id).toBeNull();
  });

  it('Propiedad missing → _airtable_property_ext_id null', () => {
    const result = normalizePortafolio(makeRecord('r1', {}), ORG_ID);
    expect(result._airtable_property_ext_id).toBeNull();
  });

  it('missing all fields → all nulls, no crash', () => {
    const result = normalizePortafolio(makeRecord('recEMPTY', {}), ORG_ID);
    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recEMPTY');
    expect(result.label).toBeNull();
    expect(result.toilet_type).toBeNull();
    expect(result.area_m2).toBeNull();
    expect(result.status).toBe('vacant');  // NOT NULL DB default — never null
    expect(result._airtable_property_ext_id).toBeNull();
  });
});

// ===========================================================================
// normalizeResponsable
// ===========================================================================

describe('normalizeResponsable', () => {
  it('happy path: maps all fields correctly from a complete record (new schema)', () => {
    const record = makeRecord('recRESP001', {
      'Nombre completo':   'Juan Pérez García',  // new name (was "Nombre(s) y apellidos")
      'N° DNI':            '12345678',
      'Número celular':    '+51 999 888 777',
      'Correo electrónico':'juan@example.com',
      'Tipo de empleo':    'Dependiente',          // new name (was "Empleo")
      'Empresa':           'Empresa XYZ',
      'Cargo':             'Ingeniero',
      'Rubro del negocio': 'Tecnología',
      // "Estado" field REMOVED from new schema — intentionally absent
      'Foto DNI': [{ url: 'https://cdn.example.com/foto.jpg', filename: 'foto.jpg' }],
    });

    const result = normalizeResponsable(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recRESP001');
    expect(result.full_name).toBe('Juan Pérez García');
    expect(result.dni).toBe('12345678');
    expect(result.phone).toBe('+51 999 888 777');
    expect(result.email).toBe('juan@example.com');
    expect(result.employment).toBe('Dependiente');
    expect(result.company).toBe('Empresa XYZ');
    expect(result.job_title).toBe('Ingeniero');
    expect(result.industry).toBe('Tecnología');
    // "status" key is absent from result (field gone from Airtable)
    expect((result as Record<string, unknown>)['status']).toBeUndefined();
    expect(result.photo_url).toBe('https://cdn.example.com/foto.jpg');
    expect(result.airtable_synced_at).toBeTruthy();
  });

  it('"Estado" field gone — status key absent from result', () => {
    const result = normalizeResponsable(makeRecord('r1', { 'Nombre completo': 'Test' }), ORG_ID);
    expect((result as Record<string, unknown>)['status']).toBeUndefined();
  });

  it('Foto DNI attachment array → photo_url = first url', () => {
    const result = normalizeResponsable(
      makeRecord('r1', {
        'Foto DNI': [
          { url: 'https://cdn.example.com/first.jpg' },
          { url: 'https://cdn.example.com/second.jpg' },
        ],
      }),
      ORG_ID
    );
    expect(result.photo_url).toBe('https://cdn.example.com/first.jpg');
  });

  it('Foto DNI empty array → photo_url null', () => {
    const result = normalizeResponsable(makeRecord('r1', { 'Foto DNI': [] }), ORG_ID);
    expect(result.photo_url).toBeNull();
  });

  it('Foto DNI missing → photo_url null', () => {
    const result = normalizeResponsable(makeRecord('r1', {}), ORG_ID);
    expect(result.photo_url).toBeNull();
  });

  it('missing all fields → nulls, no crash', () => {
    const result = normalizeResponsable(makeRecord('recEMPTY', {}), ORG_ID);
    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recEMPTY');
    expect(result.full_name).toBeNull();
    expect(result.dni).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
    expect(result.employment).toBeNull();
    expect(result.company).toBeNull();
    expect(result.job_title).toBeNull();
    expect(result.industry).toBeNull();
    // status key absent — "Estado" field removed from new Responsables schema
    expect((result as Record<string, unknown>)['status']).toBeUndefined();
    expect(result.photo_url).toBeNull();
  });
});
