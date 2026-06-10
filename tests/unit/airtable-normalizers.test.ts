/**
 * Unit tests for Airtable entity normalizers — updated for new base schema.
 *
 * New base ("Untitled Base" apphwPe2oIkGRSTkb) schema changes:
 * - normalizeTenant: contract fields removed from Residentes; property/unit link gone
 * - normalizeContract: tenant link is "👤 Residentes" (with emoji); field names updated
 * - normalizePayment: now reads Movimientos; returns discriminated union {skip, payment}
 * - normalizeProperty: renamed supply fields; removed description/current_residents
 */

import { describe, it, expect } from 'vitest';
import { normalizeProperty } from '@/lib/airtable/normalizers/normalizeProperty';
import { normalizeTenant }   from '@/lib/airtable/normalizers/normalizeTenant';
import { normalizeContract, mapContractStatus } from '@/lib/airtable/normalizers/normalizeContract';
import { normalizePayment }  from '@/lib/airtable/normalizers/normalizePayment';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makeRecord(id: string, fields: Record<string, unknown>) {
  return { id, createdTime: '2024-01-01T00:00:00.000Z', fields };
}

// ===========================================================================
// normalizeProperty
// ===========================================================================

describe('normalizeProperty', () => {
  it('maps all fields correctly from a complete record (new field names)', () => {
    const record = makeRecord('recPROP001', {
      'Propiedad':                    'Casa Lima',
      'Dirección':                    'Av. Larco 123',
      'Modalidad':                    'Coliving',
      'Distrito':                     'Miraflores',
      'N° de suministro (Luz)':       'SUP-LUZ-001',   // new name
      'N° de suministro (Agua)':      'SUP-AGU-001',   // new name
      'N° de cliente (Gas)':          'GAS-001',        // new name
      'N° total de habitaciones':     8,
    });

    const result = normalizeProperty(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recPROP001');
    expect(result.name).toBe('Casa Lima');
    expect(result.address).toBe('Av. Larco 123');
    expect(result.modality).toBe('Coliving');
    expect(result.district).toBe('Miraflores');
    expect(result.supply_number_luz).toBe('SUP-LUZ-001');
    expect(result.n_suministro_agua).toBe('SUP-AGU-001');
    expect(result.n_cliente_gas).toBe('GAS-001');
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
    // current_residents removed from new schema — not mapped, so undefined/absent
    expect(result.current_residents).toBeUndefined();
  });

  it('falls back to record.id when Propiedad field is absent', () => {
    const record = makeRecord('recPROP003', {});
    const result = normalizeProperty(record, ORG_ID);
    expect(result.name).toBe('recPROP003');
  });

  it('maps Tope luz and Tope Agua when present', () => {
    const record = makeRecord('recPROP004', {
      'Propiedad':     'Casa con Topes',
      'Tope luz (S/)': 300,
      'Tope Agua (S/)': 100,
    });
    const result = normalizeProperty(record, ORG_ID);
    expect(result.tope_luz).toBe(300);
    expect(result.tope_agua).toBe(100);
  });
});

// ===========================================================================
// normalizeTenant
// ===========================================================================

describe('normalizeTenant', () => {
  it('maps all fields correctly from a complete record (new schema)', () => {
    const record = makeRecord('recTEN001', {
      'Nombre(s) y Apellidos': 'Juan Pérez López',  // formula — capital A
      'Nombre(s)':             'Juan',
      'Apellidos':             'Pérez López',
      'N° DNI':                '12345678',
      'Fecha de nacimiento':   '1990-05-15',
      'Número celular':        '+51987654321',
      'Correo electrónico':    'juan@example.com',
      'Estado':                'Activo',
      // Contract fields are GONE from new Residentes schema — intentionally absent
    });

    const result = normalizeTenant(record, ORG_ID);

    expect(result.org_id).toBe(ORG_ID);
    expect(result.airtable_external_id).toBe('recTEN001');
    expect(result.full_name).toBe('Juan Pérez López');
    expect(result.first_name).toBe('Juan');
    expect(result.last_name).toBe('Pérez López');
    expect(result.dni).toBe('12345678');
    expect(result.birth_date).toBe('1990-05-15');
    expect(result.phone).toBe('+51987654321');
    expect(result.email).toBe('juan@example.com');
    expect(result.tenant_status).toBe('Activo');
    expect(result.airtable_synced_at).toBeTruthy();
  });

  it('does NOT set contract fields (they no longer exist on Residentes)', () => {
    const record = makeRecord('recTEN002', {
      'Nombre(s)': 'Ana',
      'Apellidos': 'García',
    });
    const result = normalizeTenant(record, ORG_ID);
    // Contract-related keys should be absent (undefined), not null, so DB upsert
    // does not overwrite values already set by the contracts sync.
    expect(result.monthly_rent).toBeUndefined();
    expect(result.deposit).toBeUndefined();
    expect(result.contract_start).toBeUndefined();
    expect(result.contract_end).toBeUndefined();
    expect(result.duration_months).toBeUndefined();
    expect(result.payment_due_day).toBeUndefined();
  });

  it('sets _airtable_property_ext_id null (no longer on Residentes)', () => {
    const record = makeRecord('recTEN003', { 'Nombre(s)': 'Carlos' });
    const result = normalizeTenant(record, ORG_ID);
    expect(result._airtable_property_ext_id).toBeNull();
    expect(result._airtable_unit_label).toBeNull();
  });

  it('does not crash when all optional fields are missing', () => {
    const record = makeRecord('recTEN004', {
      'Nombre(s) y Apellidos': 'Solo Nombre',
    });
    const result = normalizeTenant(record, ORG_ID);
    expect(result.full_name).toBe('Solo Nombre');
    expect(result.dni).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
  });

  it('falls back to firstName+lastName concatenation when formula absent', () => {
    const record = makeRecord('recTEN005', {
      'Nombre(s)': 'Luis',
      'Apellidos': 'Mendoza',
    });
    const result = normalizeTenant(record, ORG_ID);
    expect(result.full_name).toBe('Luis Mendoza');
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

  it('maps Vigente → active', () => {
    expect(mapContractStatus('Vigente')).toBe('active');
  });

  it('maps Inactivo → terminated', () => {
    expect(mapContractStatus('Inactivo')).toBe('terminated');
  });

  it('maps Finalizado → terminated', () => {
    expect(mapContractStatus('Finalizado')).toBe('terminated');
  });

  it('maps unknown status values → terminated (DB CHECK-compliant default)', () => {
    expect(mapContractStatus('Pendiente')).toBe('terminated');
    expect(mapContractStatus('unknown_value')).toBe('terminated');
  });

  it('maps null/undefined input → active (DB default)', () => {
    expect(mapContractStatus(null)).toBe('active');
    expect(mapContractStatus(undefined)).toBe('active');
  });
});

describe('normalizeContract', () => {
  it('maps all fields correctly from a complete record (new schema)', () => {
    const record = makeRecord('recCON001', {
      'Contrato ID':           'CTR-2024-001',
      '👤 Residentes':         ['recTEN001'],        // emoji field — EXACT
      'Habitacion':            ['recUNIT001'],        // no tilde
      'Tipo de contrato':      'Fijo',
      'Fecha de inicio':       '2024-01-01',          // new field name
      'Duración pactada (meses)': 12,                 // new field name
      'Fecha fin contrato':    '2025-01-01',          // new field name
      'Renta pactada (S/)':    800,                   // new field name
      'Garantía (S/)':         1600,                  // new field name
      'Estado contrato':       'Activo',              // new field name
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
    expect(result.status).toBe('active');
    expect(result._airtable_tenant_ext_id).toBe('recTEN001');
    expect(result._airtable_unit_ext_id).toBe('recUNIT001');
  });

  it('extracts first element from "👤 Residentes" emoji linked array', () => {
    const record = makeRecord('recCON002', {
      '👤 Residentes': ['recTEN001', 'recTEN002'],
    });
    const result = normalizeContract(record, ORG_ID);
    expect(result._airtable_tenant_ext_id).toBe('recTEN001');
  });

  it('sets _airtable_tenant_ext_id to null when "👤 Residentes" is absent', () => {
    const record = makeRecord('recCON003', {});
    const result = normalizeContract(record, ORG_ID);
    expect(result._airtable_tenant_ext_id).toBeNull();
  });

  it('does not crash when all optional fields are absent', () => {
    const record = makeRecord('recCON004', {});
    const result = normalizeContract(record, ORG_ID);
    expect(result.airtable_external_id).toBe('recCON004');
    expect(result.status).toBe('active');
    expect(result.monthly_rent).toBeNull();
    expect(result.tenant_id).toBeNull();
  });
});

// ===========================================================================
// normalizePayment (Movimientos schema)
// ===========================================================================

describe('normalizePayment', () => {
  it('returns skip=false and maps fields correctly from a complete record', () => {
    const record = makeRecord('recPAY001', {
      '📋 Historial (Contratos)': ['recCON001'],   // emoji field — EXACT
      'Nombres y Apellidos':       'Juan Pérez',
      'Monto depositado (S/)':     800,
      'Fecha de vencimiento':      '2024-02-05',
      'Fecha de pago':             '2024-02-04',
      'Mes':                       'Febrero',
      'Año':                       '2024',
      'Método de pago':            'Transferencia',
      'Estado pago':               'Pagado',
    });

    const result = normalizePayment(record, ORG_ID);

    expect(result.skip).toBe(false);
    if (result.skip) return;
    const p = result.payment;
    expect(p.org_id).toBe(ORG_ID);
    expect(p.airtable_external_id).toBe('recPAY001');
    expect(p.tenant_name).toBe('Juan Pérez');
    expect(p.amount).toBe(800);
    expect(p.due_date).toBe('2024-02-05');
    expect(p.paid_at).toBe('2024-02-04');
    expect(p.period_month).toBe('2024-02');
    expect(p.method).toBe('transfer');
    expect(p.status).toBe('approved');
    expect(p._airtable_contract_ext_id).toBe('recCON001');
  });

  it('returns skip=true when amount is missing', () => {
    const record = makeRecord('recPAY002', {
      'Fecha de vencimiento': '2024-03-05',
    });
    const result = normalizePayment(record, ORG_ID);
    expect(result.skip).toBe(true);
  });

  it('falls back to Monto renta (S/) when Monto depositado absent', () => {
    const record = makeRecord('recPAY003', {
      'Monto depositado (S/)': undefined,
      'Monto renta (S/)':      900,
      'Fecha de vencimiento':  '2024-03-05',
    });
    const result = normalizePayment(record, ORG_ID);
    expect(result.skip).toBe(false);
    if (!result.skip) expect(result.payment.amount).toBe(900);
  });

  it('returns skip=true when both dates missing', () => {
    const record = makeRecord('recPAY004', {
      'Monto depositado (S/)': 500,
    });
    const result = normalizePayment(record, ORG_ID);
    expect(result.skip).toBe(true);
  });

  it('does not crash when all optional fields are missing (still skips on no amount)', () => {
    const record = makeRecord('recPAY005', {});
    const result = normalizePayment(record, ORG_ID);
    expect(result.skip).toBe(true);
  });
});
