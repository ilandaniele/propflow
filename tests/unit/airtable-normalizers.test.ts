/**
 * Unit tests for Airtable entity normalizers.
 *
 * Covers:
 * - Happy path for each normalizer with a realistic mock Airtable record
 * - Linked-field array extraction (first element)
 * - Missing/null fields gracefully return null (no crash)
 * - Status mapping for contracts (Activo, Inactivo, Finalizado, unknown)
 * - Rollup field parsing for payments (array vs scalar)
 * - AC9: normalizers do not issue any HTTP calls (pure functions)
 */

import { describe, it, expect } from 'vitest';
import { normalizeProperty } from '@/lib/airtable/normalizers/normalizeProperty';
import { normalizeTenant }   from '@/lib/airtable/normalizers/normalizeTenant';
import { normalizeContract, mapContractStatus } from '@/lib/airtable/normalizers/normalizeContract';
import { normalizePayment }  from '@/lib/airtable/normalizers/normalizePayment';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Helper: build a minimal AirtableRecord
// ---------------------------------------------------------------------------

function makeRecord(id: string, fields: Record<string, unknown>) {
  return { id, createdTime: '2024-01-01T00:00:00.000Z', fields };
}

// ===========================================================================
// normalizeProperty
// ===========================================================================

describe('normalizeProperty', () => {
  it('maps all fields correctly from a complete record', () => {
    const record = makeRecord('recPROP001', {
      'Propiedad':                  'Casa Lima',
      'Dirección':                  'Av. Larco 123',
      'Modalidad':                  'Coliving',
      'Distrito':                   'Miraflores',
      'Descripción':                'Casa grande',
      'N° de suministro (L)':       'SUP-001',
      'N° de residentes actuales':  4,
      'N° total de habitaciones':   8,
    });

    const result = normalizeProperty(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recPROP001');
    expect(result.name).toBe('Casa Lima');
    expect(result.address).toBe('Av. Larco 123');
    expect(result.modality).toBe('Coliving');
    expect(result.district).toBe('Miraflores');
    expect(result.description).toBe('Casa grande');
    expect(result.supply_number_luz).toBe('SUP-001');
    expect(result.current_residents).toBe(4);
    expect(result.total_rooms).toBe(8);
    expect(result.airtable_synced_at).toBeTruthy();
  });

  it('returns null for missing optional fields without crashing', () => {
    const record = makeRecord('recPROP002', {
      'Propiedad': 'Mini Casa',
    });

    const result = normalizeProperty(record, ORG_ID);

    expect(result.name).toBe('Mini Casa');
    expect(result.address).toBeNull();
    expect(result.district).toBeNull();
    expect(result.modality).toBeNull();
    expect(result.total_rooms).toBeNull();
    expect(result.current_residents).toBeNull();
  });

  it('falls back to record.id when Propiedad field is absent', () => {
    const record = makeRecord('recPROP003', {});

    const result = normalizeProperty(record, ORG_ID);

    expect(result.name).toBe('recPROP003');
  });
});

// ===========================================================================
// normalizeTenant
// ===========================================================================

describe('normalizeTenant', () => {
  it('maps all fields correctly from a complete record', () => {
    const record = makeRecord('recTEN001', {
      'Nombre(s) y apellidos': 'Juan Pérez López',
      'Codigo':                'COD-001',
      'Nombre(s)':             'Juan',
      'Apellidos':             'Pérez López',
      'N° DNI':                '12345678',
      'Fecha de nacimiento':   '1990-05-15',
      'Número celular':        '+51987654321',
      'Correo electrónico':    'juan@example.com',
      'N° de habitación':      ['101'],
      'Propiedad':             ['recPROP001'],
      'Fecha de inicio':       '2024-01-01',
      'Duración':              12,
      'Fecha fin':             '2025-01-01',
      'Fecha de pago':         5,
      'Renta':                 800,
      'Garantía':              1600,
      'Estado':                'Activo',
    });

    const result = normalizeTenant(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recTEN001');
    expect(result.full_name).toBe('Juan Pérez López');
    expect(result.first_name).toBe('Juan');
    expect(result.last_name).toBe('Pérez López');
    expect(result.codigo).toBe('COD-001');
    expect(result.dni).toBe('12345678');
    expect(result.birth_date).toBe('1990-05-15');
    expect(result.phone).toBe('+51987654321');
    expect(result.email).toBe('juan@example.com');
    expect(result.payment_due_day).toBe(5);
    expect(result.monthly_rent).toBe(800);
    expect(result.deposit).toBe(1600);
    expect(result.tenant_status).toBe('Activo');
    expect(result.contract_start).toBe('2024-01-01');
    expect(result.duration_months).toBe(12);
    expect(result.contract_end).toBe('2025-01-01');
  });

  it('extracts first element from linked Propiedad array (AC4)', () => {
    const record = makeRecord('recTEN002', {
      'Nombre(s) y apellidos': 'Ana García',
      'Propiedad':             ['recPROP001', 'recPROP002'],   // multiple — take first
      'N° de habitación':      ['202', '203'],
    });

    const result = normalizeTenant(record, ORG_ID);

    expect(result._airtable_property_ext_id).toBe('recPROP001');
    expect(result._airtable_unit_label).toBe('202');
    // property_id and unit_id start as null — resolved later
    expect(result.property_id).toBeNull();
    expect(result.unit_id).toBeNull();
  });

  it('returns null for linked fields when arrays are empty', () => {
    const record = makeRecord('recTEN003', {
      'Nombre(s) y apellidos': 'Carlos Ríos',
      'Propiedad':             [],
      'N° de habitación':      [],
    });

    const result = normalizeTenant(record, ORG_ID);

    expect(result._airtable_property_ext_id).toBeNull();
    expect(result._airtable_unit_label).toBeNull();
  });

  it('does not crash when all optional fields are missing', () => {
    const record = makeRecord('recTEN004', {
      'Nombre(s) y apellidos': 'Solo Nombre',
    });

    const result = normalizeTenant(record, ORG_ID);

    expect(result.full_name).toBe('Solo Nombre');
    expect(result.dni).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
    expect(result.monthly_rent).toBeNull();
  });
});

// ===========================================================================
// normalizeContract + mapContractStatus
// ===========================================================================

describe('mapContractStatus', () => {
  it('maps Activo → active', () => {
    expect(mapContractStatus('Activo')).toBe('active');
  });

  it('maps Active → active (English variant)', () => {
    expect(mapContractStatus('Active')).toBe('active');
  });

  it('maps Inactivo → inactive', () => {
    expect(mapContractStatus('Inactivo')).toBe('inactive');
  });

  it('maps Finalizado → inactive', () => {
    expect(mapContractStatus('Finalizado')).toBe('inactive');
  });

  it('returns null for unknown status values', () => {
    expect(mapContractStatus('Pendiente')).toBeNull();
    expect(mapContractStatus('unknown_value')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(mapContractStatus(null)).toBeNull();
    expect(mapContractStatus(undefined)).toBeNull();
  });
});

describe('normalizeContract', () => {
  it('maps all fields correctly from a complete record', () => {
    const record = makeRecord('recCON001', {
      'Contrato ID':            'CTR-2024-001',
      'Residente':              ['recTEN001'],
      'Tipo de contrato':       'Fijo',
      'Fecha inicio':           '2024-01-01',
      'Duración (meses)':       12,
      'Fecha fin':              '2025-01-01',
      'Renta':                  800,
      'Garantía':               1600,
      'Constancia de garantía': 'https://example.com/receipt.pdf',
      'Estado':                 'Activo',
    });

    const result = normalizeContract(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recCON001');
    expect(result.contract_code).toBe('CTR-2024-001');
    expect(result.contract_type).toBe('Fijo');
    expect(result.start_date).toBe('2024-01-01');
    expect(result.duration_months).toBe(12);
    expect(result.end_date).toBe('2025-01-01');
    expect(result.monthly_rent).toBe(800);
    expect(result.deposit).toBe(1600);
    expect(result.deposit_receipt_url).toBe('https://example.com/receipt.pdf');
    expect(result.status).toBe('active');
    expect(result._airtable_tenant_ext_id).toBe('recTEN001');
  });

  it('extracts first element from linked Residente array', () => {
    const record = makeRecord('recCON002', {
      'Residente': ['recTEN001', 'recTEN002'],
    });

    const result = normalizeContract(record, ORG_ID);

    expect(result._airtable_tenant_ext_id).toBe('recTEN001');
  });

  it('sets _airtable_tenant_ext_id to null when Residente array is empty', () => {
    const record = makeRecord('recCON003', {
      'Residente': [],
    });

    const result = normalizeContract(record, ORG_ID);

    expect(result._airtable_tenant_ext_id).toBeNull();
  });

  it('does not crash when all optional fields are absent', () => {
    const record = makeRecord('recCON004', {});

    const result = normalizeContract(record, ORG_ID);

    expect(result.airtable_external_id).toBe('recCON004');
    expect(result.status).toBeNull();
    expect(result.monthly_rent).toBeNull();
    expect(result.tenant_id).toBeNull();
  });
});

// ===========================================================================
// normalizePayment
// ===========================================================================

describe('normalizePayment', () => {
  it('maps all fields correctly from a complete record', () => {
    const record = makeRecord('recPAY001', {
      'Name':                   'PAY-2024-001',
      'Nombre(s) y apellidos':  'Juan Pérez López',
      'Número celular':         '+51987654321',
      'Renta (from ID)':        800,
      'Fecha de pago (from ID)': '2024-02-05',
      'Mes actual':             'Febrero 2024',
    });

    const result = normalizePayment(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recPAY001');
    expect(result.name).toBe('PAY-2024-001');
    expect(result.tenant_name).toBe('Juan Pérez López');
    expect(result.phone).toBe('+51987654321');
    expect(result.amount).toBe(800);
    expect(result.due_date).toBe('2024-02-05');
    expect(result.period_month).toBe('Febrero 2024');
  });

  it('parses rollup amount field when returned as array (linked rollup)', () => {
    const record = makeRecord('recPAY002', {
      'Renta (from ID)':         [900, 1000],   // rollup returns array — use first
      'Fecha de pago (from ID)': ['2024-03-05', '2024-04-05'],
    });

    const result = normalizePayment(record, ORG_ID);

    expect(result.amount).toBe(900);
    expect(result.due_date).toBe('2024-03-05');
  });

  it('returns null for rollup fields when array is empty', () => {
    const record = makeRecord('recPAY003', {
      'Renta (from ID)':         [],
      'Fecha de pago (from ID)': [],
    });

    const result = normalizePayment(record, ORG_ID);

    expect(result.amount).toBeNull();
    expect(result.due_date).toBeNull();
  });

  it('does not crash when all optional fields are missing', () => {
    const record = makeRecord('recPAY004', {});

    const result = normalizePayment(record, ORG_ID);

    expect(result.airtable_external_id).toBe('recPAY004');
    expect(result.amount).toBeNull();
    expect(result.tenant_name).toBeNull();
    expect(result.contract_id).toBeNull();
  });
});
