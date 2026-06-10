/**
 * tests/unit/airtable/normalizeServicePayments.test.ts
 *
 * Unit tests for the new single-table "Pago de servicios" normalizer.
 */

import { describe, it, expect } from 'vitest';
import {
  mapServiceType,
  buildServiceMonthKey,
  normalizeServicePaymentRecord,
  aggregateServicePaymentRecords,
} from '@/lib/airtable/normalizers/normalizeServicePayments';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makeServiceRecord(
  overrides: Partial<AirtableRecord['fields']> = {},
  id = 'recSERVICE001'
): AirtableRecord {
  return {
    id,
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      'Tipo de servicio': 'Agua',
      'Mes':              'Enero',
      'Año':              '2026',
      'Monto (S/)':       150,
      'Tope (S/) auto':   200,
      'Estado':           'Pagado',
      'Constancia':       [{ url: 'https://example.com/const.pdf', id: 'att1' }],
      'Propiedad':        ['recPROP001'],
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// mapServiceType
// ---------------------------------------------------------------------------

describe('mapServiceType', () => {
  it('maps agua variants', () => {
    expect(mapServiceType('Agua')).toBe('agua');
    expect(mapServiceType('agua potable')).toBe('agua');
  });

  it('maps luz variants', () => {
    expect(mapServiceType('Luz')).toBe('luz');
    expect(mapServiceType('Electricidad')).toBe('luz');
    expect(mapServiceType('eléctrico')).toBe('luz');
  });

  it('maps gas variants', () => {
    expect(mapServiceType('Gas')).toBe('gas');
    expect(mapServiceType('GAS NATURAL')).toBe('gas');
  });

  it('maps internet variants', () => {
    expect(mapServiceType('Internet')).toBe('internet');
    expect(mapServiceType('WiFi')).toBe('internet');
  });

  it('maps unknown to otro', () => {
    expect(mapServiceType('Mantenimiento')).toBe('otro');
    expect(mapServiceType(undefined)).toBe('otro');
    expect(mapServiceType(null)).toBe('otro');
  });
});

// ---------------------------------------------------------------------------
// buildServiceMonthKey
// ---------------------------------------------------------------------------

describe('buildServiceMonthKey', () => {
  it('parses Spanish month names', () => {
    expect(buildServiceMonthKey('Enero',     '2026')).toBe('2026-01');
    expect(buildServiceMonthKey('Marzo',     '2026')).toBe('2026-03');
    expect(buildServiceMonthKey('Diciembre', '2026')).toBe('2026-12');
  });

  it('parses numeric month strings', () => {
    expect(buildServiceMonthKey('3',  '2026')).toBe('2026-03');
    expect(buildServiceMonthKey('12', '2026')).toBe('2026-12');
  });

  it('uses raw fallback for unknown month', () => {
    const result = buildServiceMonthKey('Quartember', '2026');
    expect(result).toContain('2026');
  });

  it('uses ???? placeholder for absent año', () => {
    const result = buildServiceMonthKey('Enero', undefined);
    expect(result).toContain('????');
  });
});

// ---------------------------------------------------------------------------
// normalizeServicePaymentRecord
// ---------------------------------------------------------------------------

describe('normalizeServicePaymentRecord', () => {
  it('extracts correct fields from a well-formed record', () => {
    const inter = normalizeServicePaymentRecord(makeServiceRecord());
    expect(inter.propertyExtId).toBe('recPROP001');
    expect(inter.serviceType).toBe('agua');
    expect(inter.monthKey).toBe('2026-01');
    expect(inter.entry.amount).toBe(150);
    expect(inter.entry.eecc).toBe('Pagado');
    expect(inter.entry.receipt_url).toBe('https://example.com/const.pdf');
    expect(inter.tope).toBe(200);
  });

  it('returns null propertyExtId when Propiedad is absent', () => {
    const inter = normalizeServicePaymentRecord(makeServiceRecord({ 'Propiedad': undefined }));
    expect(inter.propertyExtId).toBeNull();
  });

  it('returns null entry.receipt_url when Constancia absent', () => {
    const inter = normalizeServicePaymentRecord(makeServiceRecord({ 'Constancia': undefined }));
    expect(inter.entry.receipt_url).toBeNull();
  });

  it('returns null tope when Tope (S/) auto absent', () => {
    const inter = normalizeServicePaymentRecord(makeServiceRecord({ 'Tope (S/) auto': undefined }));
    expect(inter.tope).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateServicePaymentRecords — grouping / aggregation
// ---------------------------------------------------------------------------

describe('aggregateServicePaymentRecords', () => {
  it('produces one row per (property, serviceType) for distinct records', () => {
    const records = [
      makeServiceRecord({ 'Tipo de servicio': 'Agua', 'Mes': 'Enero',   'Año': '2026', 'Propiedad': ['recPROP001'] }, 'recA'),
      makeServiceRecord({ 'Tipo de servicio': 'Luz',  'Mes': 'Enero',   'Año': '2026', 'Propiedad': ['recPROP001'] }, 'recB'),
      makeServiceRecord({ 'Tipo de servicio': 'Agua', 'Mes': 'Febrero', 'Año': '2026', 'Propiedad': ['recPROP001'] }, 'recC'),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    // Agua for recPROP001 + Luz for recPROP001 = 2 rows
    expect(rows).toHaveLength(2);
    const aguaRow = rows.find(r => r.service_type === 'agua');
    expect(aguaRow).toBeDefined();
    // Agua row should have 2 months
    expect(Object.keys(aguaRow!.monthly_data)).toHaveLength(2);
    expect(aguaRow!.monthly_data['2026-01']).toBeDefined();
    expect(aguaRow!.monthly_data['2026-02']).toBeDefined();
  });

  it('groups 3 records into 1 row when same (property, service) with 3 months', () => {
    const records = [
      makeServiceRecord({ 'Mes': 'Enero',   'Año': '2026', 'Monto (S/)': 100, 'Propiedad': ['recPROP002'] }, 'rec1'),
      makeServiceRecord({ 'Mes': 'Febrero', 'Año': '2026', 'Monto (S/)': 110, 'Propiedad': ['recPROP002'] }, 'rec2'),
      makeServiceRecord({ 'Mes': 'Marzo',   'Año': '2026', 'Monto (S/)': 120, 'Propiedad': ['recPROP002'] }, 'rec3'),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].monthly_data)).toHaveLength(3);
    expect(rows[0].monthly_data['2026-01'].amount).toBe(100);
    expect(rows[0].monthly_data['2026-02'].amount).toBe(110);
    expect(rows[0].monthly_data['2026-03'].amount).toBe(120);
  });

  it('uses synthetic airtable_external_id = propertyExtId::serviceType', () => {
    const records = [
      makeServiceRecord({ 'Propiedad': ['recPROP003'], 'Tipo de servicio': 'Gas' }, 'recG1'),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows[0].airtable_external_id).toBe('recPROP003::gas');
  });

  it('skips records without a property link', () => {
    const records = [
      makeServiceRecord({ 'Propiedad': undefined }, 'recNOPROP'),
    ];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateServicePaymentRecords([], ORG_ID)).toHaveLength(0);
  });

  it('sets _airtable_property_ext_id correctly', () => {
    const records = [makeServiceRecord({ 'Propiedad': ['recPROP004'] }, 'recSP1')];
    const rows = aggregateServicePaymentRecords(records, ORG_ID);
    expect(rows[0]._airtable_property_ext_id).toBe('recPROP004');
  });
});
