/**
 * Unit tests — normalizeServicePayments (new single-table schema)
 *
 * The old 4-table normalizer (agua/internet/gas/luz with parseMonthlyData) has been
 * replaced by a single-table model. These tests cover the new functions:
 *   - normalizeServicePaymentRecord (one Airtable record → intermediate)
 *   - aggregateServicePaymentRecords (all records → one row per property+serviceType)
 *   - mapServiceType, buildServiceMonthKey
 *
 * The deprecated normalizeServicePayment (legacy compat) is also tested for continuity.
 *
 * Pure function tests — no DB, no HTTP, no FS access.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeServicePaymentRecord,
  aggregateServicePaymentRecords,
  normalizeServicePayment,
  mapServiceType,
  buildServiceMonthKey,
} from '../../src/lib/airtable/normalizers/normalizeServicePayments';
import type { AirtableRecord } from '../../src/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, createdTime: '2026-01-01T00:00:00.000Z', fields };
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// mapServiceType
// ---------------------------------------------------------------------------

describe('mapServiceType', () => {
  it('Agua → agua', () => expect(mapServiceType('Agua')).toBe('agua'));
  it('Luz → luz', () => expect(mapServiceType('Luz')).toBe('luz'));
  it('Electricidad → luz', () => expect(mapServiceType('Electricidad')).toBe('luz'));
  it('Gas → gas', () => expect(mapServiceType('Gas')).toBe('gas'));
  it('Internet → internet', () => expect(mapServiceType('Internet')).toBe('internet'));
  it('WiFi → internet', () => expect(mapServiceType('WiFi')).toBe('internet'));
  it('Unknown → otro', () => expect(mapServiceType('Mantenimiento')).toBe('otro'));
  it('undefined → otro', () => expect(mapServiceType(undefined)).toBe('otro'));
});

// ---------------------------------------------------------------------------
// buildServiceMonthKey
// ---------------------------------------------------------------------------

describe('buildServiceMonthKey', () => {
  it('Spanish full names', () => {
    expect(buildServiceMonthKey('Enero',     '2026')).toBe('2026-01');
    expect(buildServiceMonthKey('Marzo',     '2026')).toBe('2026-03');
    expect(buildServiceMonthKey('Diciembre', '2026')).toBe('2026-12');
  });
  it('numeric month strings', () => {
    expect(buildServiceMonthKey('3',  '2026')).toBe('2026-03');
    expect(buildServiceMonthKey('12', '2026')).toBe('2026-12');
  });
  it('unknown month → raw concatenation', () => {
    const result = buildServiceMonthKey('Quartember', '2026');
    expect(result).toContain('2026');
  });
  it('undefined año → ???? placeholder', () => {
    expect(buildServiceMonthKey('Enero', undefined)).toContain('????');
  });
});

// ---------------------------------------------------------------------------
// normalizeServicePaymentRecord — single record
// ---------------------------------------------------------------------------

describe('normalizeServicePaymentRecord — agua record', () => {
  it('happy path: all fields populated', () => {
    const record = makeRecord('recSP001', {
      'Tipo de servicio': 'Agua',
      'Mes':              'Enero',
      'Año':              '2026',
      'Monto (S/)':       150,
      'Tope (S/) auto':   200,
      'Estado':           'Pagado',
      'Constancia':       [{ url: 'https://bucket.co/agua.pdf', id: 'att1' }],
      'Propiedad':        ['recPROP001'],
    });

    const inter = normalizeServicePaymentRecord(record);

    expect(inter.propertyExtId).toBe('recPROP001');
    expect(inter.serviceType).toBe('agua');
    expect(inter.monthKey).toBe('2026-01');
    expect(inter.entry.amount).toBe(150);
    expect(inter.entry.eecc).toBe('Pagado');
    expect(inter.entry.receipt_url).toBe('https://bucket.co/agua.pdf');
    expect(inter.tope).toBe(200);
  });

  it('tope null when Tope (S/) auto absent', () => {
    const record = makeRecord('recSP002', {
      'Tipo de servicio': 'Gas',
      'Mes':              'Febrero',
      'Año':              '2026',
      'Monto (S/)':       80,
      'Propiedad':        ['recPROP001'],
    });
    const inter = normalizeServicePaymentRecord(record);
    expect(inter.tope).toBeNull();
  });

  it('null propertyExtId when Propiedad absent', () => {
    const record = makeRecord('recSP003', {
      'Tipo de servicio': 'Luz',
      'Mes':              'Marzo',
      'Año':              '2026',
      'Monto (S/)':       300,
    });
    const inter = normalizeServicePaymentRecord(record);
    expect(inter.propertyExtId).toBeNull();
  });

  it('null receipt_url when Constancia absent', () => {
    const record = makeRecord('recSP004', {
      'Tipo de servicio': 'Internet',
      'Mes':              'Abril',
      'Año':              '2026',
      'Monto (S/)':       120,
      'Propiedad':        ['recPROP001'],
    });
    const inter = normalizeServicePaymentRecord(record);
    expect(inter.entry.receipt_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateServicePaymentRecords — grouping / monthly_data build
// ---------------------------------------------------------------------------

describe('aggregateServicePaymentRecords — new single-table model', () => {
  it('groups 3 records for same property+service → 1 row with 3 monthly_data entries', () => {
    const records = [
      makeRecord('recA', { 'Tipo de servicio': 'Agua', 'Mes': 'Enero',   'Año': '2026', 'Monto (S/)': 100, 'Propiedad': ['recPROP001'] }),
      makeRecord('recB', { 'Tipo de servicio': 'Agua', 'Mes': 'Febrero', 'Año': '2026', 'Monto (S/)': 110, 'Propiedad': ['recPROP001'] }),
      makeRecord('recC', { 'Tipo de servicio': 'Agua', 'Mes': 'Marzo',   'Año': '2026', 'Monto (S/)': 120, 'Propiedad': ['recPROP001'] }),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].monthly_data)).toHaveLength(3);
    expect(rows[0].monthly_data['2026-01']?.amount).toBe(100);
    expect(rows[0].monthly_data['2026-02']?.amount).toBe(110);
    expect(rows[0].monthly_data['2026-03']?.amount).toBe(120);
  });

  it('produces one row per (property, serviceType)', () => {
    const records = [
      makeRecord('r1', { 'Tipo de servicio': 'Agua', 'Mes': 'Enero', 'Año': '2026', 'Monto (S/)': 100, 'Propiedad': ['recPROP001'] }),
      makeRecord('r2', { 'Tipo de servicio': 'Luz',  'Mes': 'Enero', 'Año': '2026', 'Monto (S/)': 200, 'Propiedad': ['recPROP001'] }),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.service_type).sort()).toEqual(['agua', 'luz']);
  });

  it('synthetic airtable_external_id = propertyExtId::serviceType', () => {
    const records = [
      makeRecord('r1', { 'Tipo de servicio': 'Gas', 'Mes': 'Enero', 'Año': '2026', 'Monto (S/)': 75, 'Propiedad': ['recPROP002'] }),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows[0].airtable_external_id).toBe('recPROP002::gas');
  });

  it('skips records without a property link', () => {
    const records = [
      makeRecord('rNoProp', { 'Tipo de servicio': 'Agua', 'Mes': 'Enero', 'Año': '2026', 'Monto (S/)': 50 }),
    ];
    expect(aggregateServicePaymentRecords(records, ORG_ID)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateServicePaymentRecords([], ORG_ID)).toHaveLength(0);
  });

  it('sets org_id on each row', () => {
    const records = [
      makeRecord('r1', { 'Tipo de servicio': 'Agua', 'Mes': 'Enero', 'Año': '2026', 'Monto (S/)': 100, 'Propiedad': ['recPROP001'] }),
    ];
    expect(aggregateServicePaymentRecords(records, ORG_ID)[0].org_id).toBe(ORG_ID);
  });
});

// ---------------------------------------------------------------------------
// Legacy normalizeServicePayment (deprecated compat) — still importable
// ---------------------------------------------------------------------------

describe('normalizeServicePayment — legacy compat (deprecated)', () => {
  it('returns a NormalizedServicePayment with the given serviceType', () => {
    const record = makeRecord('recLEGACY', {
      'Tipo de servicio': 'Luz',
      'Mes':              'Enero',
      'Año':              '2026',
      'Monto (S/)':       300,
      'Propiedad':        ['recPROP005'],
    });
    const result = normalizeServicePayment(record, ORG_ID, 'luz');
    expect(result.service_type).toBe('luz');
    expect(result.airtable_external_id).toBe('recLEGACY::luz');
    expect(result.org_id).toBe(ORG_ID);
  });
});
