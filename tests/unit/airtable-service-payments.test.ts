/**
 * Unit tests — normalizeServicePayment + parseMonthlyData
 *
 * Pure function tests — no DB, no HTTP, no FS access.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeServicePayment,
  parseMonthlyData,
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
// normalizeServicePayment — agua
// ---------------------------------------------------------------------------

describe('normalizeServicePayment — agua', () => {
  it('happy path: supply_number, monthly_data with amount + eecc + receipt_url', () => {
    const record = makeRecord('recABC001', {
      'Propiedad': ['recPROP001'],
      'N° de suministro (A)': '12345-A',
      'Monto 01 - 26 (A) agua': 150,
      'EECC 01 - 26': 'eecc-link',
      'Const. 01 - 26 (A)': [{ url: 'https://bucket.co/receipt.pdf' }],
    });

    const result = normalizeServicePayment(record, ORG_ID, 'agua');

    expect(result.org_id).toBe(ORG_ID);
    expect(result.service_type).toBe('agua');
    expect(result.supply_number).toBe('12345-A');
    expect(result.airtable_external_id).toBe('recABC001::agua');
    expect(result._airtable_property_ext_id).toBe('recPROP001');
    expect(result.monthly_data['2026-01']).toEqual({
      amount: 150,
      eecc: 'eecc-link',
      receipt_url: 'https://bucket.co/receipt.pdf',
    });
    expect(result.tope).toBeUndefined();
  });

  it('sets airtable_external_id as record.id::agua', () => {
    const record = makeRecord('recXYZ999', { 'Propiedad': [] });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result.airtable_external_id).toBe('recXYZ999::agua');
  });

  it('amount as string "150.50" → 150.5', () => {
    const record = makeRecord('recA', {
      'Monto 01 - 26 (A) agua': '150.50',
      'Const. 01 - 26 (A)': null,
    });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result.monthly_data['2026-01']?.amount).toBe(150.5);
  });

  it('amount empty string → null', () => {
    const record = makeRecord('recA', {
      'Monto 01 - 26 (A) agua': '',
      'EECC 01 - 26': 'some-eecc',
    });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result.monthly_data['2026-01']?.amount).toBeNull();
    expect(result.monthly_data['2026-01']?.eecc).toBe('some-eecc');
  });

  it('amount NaN string → null', () => {
    const record = makeRecord('recA', {
      'Monto 01 - 26 (A) agua': 'not-a-number',
      'EECC 01 - 26': null,
      'Const. 01 - 26 (A)': null,
    });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    // no non-null value → month should not appear
    expect(result.monthly_data['2026-01']).toBeUndefined();
  });

  it('empty Monto column → month NOT included in monthly_data', () => {
    const record = makeRecord('recA', {
      'Monto 01 - 26 (A) agua': null,
      'EECC 01 - 26': null,
      'Const. 01 - 26 (A)': null,
    });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result.monthly_data['2026-01']).toBeUndefined();
  });

  it('Propiedad linked array → _airtable_property_ext_id = first id', () => {
    const record = makeRecord('recA', { 'Propiedad': ['recPROP001', 'recPROP002'] });
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result._airtable_property_ext_id).toBe('recPROP001');
  });

  it('missing all fields → no crash, empty monthly_data, null supply_number', () => {
    const record = makeRecord('recA', {});
    const result = normalizeServicePayment(record, ORG_ID, 'agua');
    expect(result.supply_number).toBeNull();
    expect(result.monthly_data).toEqual({});
    expect(result._airtable_property_ext_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeServicePayment — internet
// ---------------------------------------------------------------------------

describe('normalizeServicePayment — internet', () => {
  it('happy path: Código de pago populated, monthly_data parsed (no eecc column)', () => {
    const record = makeRecord('recINT001', {
      'Propiedad': ['recPROP002'],
      'Código de pago (I)': 'COD-INT-9999',
      'Monto 01 - 26 (I)': 299,
      'Const. 01 - 26 (I)': 'https://bucket.co/int.pdf',
    });

    const result = normalizeServicePayment(record, ORG_ID, 'internet');

    expect(result.service_type).toBe('internet');
    expect(result.supply_number).toBe('COD-INT-9999');
    expect(result.airtable_external_id).toBe('recINT001::internet');
    expect(result.monthly_data['2026-01']).toEqual({
      amount: 299,
      eecc: null,
      receipt_url: 'https://bucket.co/int.pdf',
    });
  });

  it('no eecc column → eecc always null', () => {
    const record = makeRecord('recINT002', {
      'Monto 02 - 26 (I)': 100,
      'EECC 02 - 26': 'should-be-ignored',
    });
    const result = normalizeServicePayment(record, ORG_ID, 'internet');
    // parseMonthlyData with eeccPrefix=null → eecc always null
    expect(result.monthly_data['2026-02']?.eecc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeServicePayment — gas
// ---------------------------------------------------------------------------

describe('normalizeServicePayment — gas', () => {
  it('happy path: N° de cliente populated', () => {
    const record = makeRecord('recGAS001', {
      'Propiedad': ['recPROP003'],
      'N° de cliente (G)': 'GAS-CLIENT-42',
      'Monto 03 - 26 (G)': 85.5,
      'Const. 03 - 26 (G)': [{ url: 'https://bucket.co/gas.pdf' }],
    });

    const result = normalizeServicePayment(record, ORG_ID, 'gas');

    expect(result.service_type).toBe('gas');
    expect(result.supply_number).toBe('GAS-CLIENT-42');
    expect(result.monthly_data['2026-03']).toEqual({
      amount: 85.5,
      eecc: null,
      receipt_url: 'https://bucket.co/gas.pdf',
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeServicePayment — luz
// ---------------------------------------------------------------------------

describe('normalizeServicePayment — luz', () => {
  it('happy path: N° suministro + tope populated', () => {
    const record = makeRecord('recLUZ001', {
      'Propiedad': ['recPROP004'],
      'N° de suministro (L)': 'LUZ-SUM-777',
      'Tope': 500,
      'Monto 04 - 26 (L)': 320,
      'Const. 04 - 26 (L)': [{ url: 'https://bucket.co/luz.pdf' }],
    });

    const result = normalizeServicePayment(record, ORG_ID, 'luz');

    expect(result.service_type).toBe('luz');
    expect(result.supply_number).toBe('LUZ-SUM-777');
    expect(result.tope).toBe(500);
    expect(result.monthly_data['2026-04']).toEqual({
      amount: 320,
      eecc: null,
      receipt_url: 'https://bucket.co/luz.pdf',
    });
  });

  it('tope null when not set', () => {
    const record = makeRecord('recLUZ002', {});
    const result = normalizeServicePayment(record, ORG_ID, 'luz');
    expect(result.tope).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMonthlyData — edge cases
// ---------------------------------------------------------------------------

describe('parseMonthlyData', () => {
  it('multiple months parsed correctly', () => {
    const fields: Record<string, unknown> = {
      'Monto 01 - 26 (A) agua': 100,
      'EECC 01 - 26': 'eecc-jan',
      'Const. 01 - 26 (A)': [{ url: 'http://rec1.pdf' }],
      'Monto 02 - 26 (A) agua': 200,
      'EECC 02 - 26': null,
      'Const. 02 - 26 (A)': null,
    };

    const result = parseMonthlyData(fields, 'A', 'EECC', 'A');

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['2026-01']?.amount).toBe(100);
    expect(result['2026-02']?.amount).toBe(200);
  });

  it('receipt_url as attachment array → takes first .url', () => {
    const fields: Record<string, unknown> = {
      'Monto 05 - 26 (L)': 1,
      'Const. 05 - 26 (L)': [{ url: 'https://first.pdf' }, { url: 'https://second.pdf' }],
    };
    const result = parseMonthlyData(fields, 'L', null, 'L');
    expect(result['2026-05']?.receipt_url).toBe('https://first.pdf');
  });

  it('receipt_url as plain string', () => {
    const fields: Record<string, unknown> = {
      'Monto 06 - 26 (I)': 50,
      'Const. 06 - 26 (I)': 'https://plain.pdf',
    };
    const result = parseMonthlyData(fields, 'I', null, 'I');
    expect(result['2026-06']?.receipt_url).toBe('https://plain.pdf');
  });

  it('columns from other service types not included (suffix filter)', () => {
    const fields: Record<string, unknown> = {
      'Monto 01 - 26 (A) agua': 100,  // agua
      'Monto 01 - 26 (I)': 200,       // internet
    };
    // Parsing as internet — should only pick up (I)
    const result = parseMonthlyData(fields, 'I', null, 'I');
    expect(result['2026-01']?.amount).toBe(200);
  });
});
