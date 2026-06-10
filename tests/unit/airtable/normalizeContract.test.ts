/**
 * tests/unit/airtable/normalizeContract.test.ts
 *
 * Unit tests for normalizeContract — new base schema (Historial / Contratos).
 * Field "👤 Residentes" (with emoji) is the tenant link.
 * Field "Habitacion" (no tilde) is the unit link.
 */

import { describe, it, expect } from 'vitest';
import { normalizeContract, mapContractStatus, CONTRACT_FIELD } from '@/lib/airtable/normalizers/normalizeContract';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makeContractRecord(overrides: Partial<AirtableRecord['fields']> = {}): AirtableRecord {
  return {
    id: 'recCONTRACT123',
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      [CONTRACT_FIELD.CONTRACT_CODE]:       'CTR-001',
      [CONTRACT_FIELD.START_DATE]:          '2026-01-01',
      [CONTRACT_FIELD.END_DATE]:            '2026-12-31',
      [CONTRACT_FIELD.DURATION_MONTHS]:     12,
      [CONTRACT_FIELD.MONTHLY_RENT]:        1200,
      [CONTRACT_FIELD.DEPOSIT]:             2400,
      [CONTRACT_FIELD.CONTRACT_TYPE]:       'Individual',
      [CONTRACT_FIELD.STATUS]:              'Vigente',
      // Emoji field name — EXACT match required
      '👤 Residentes':                      ['recTENANT001'],
      'Habitacion':                          ['recUNIT001'],
      'Propiedad':                           ['recPROP001'],
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('normalizeContract — new base schema', () => {
  it('maps basic fields correctly', () => {
    const c = normalizeContract(makeContractRecord(), ORG_ID);
    expect(c.org_id).toBe(ORG_ID);
    expect(c.airtable_external_id).toBe('recCONTRACT123');
    expect(c.contract_code).toBe('CTR-001');
    expect(c.start_date).toBe('2026-01-01');
    expect(c.end_date).toBe('2026-12-31');
    expect(c.duration_months).toBe(12);
    expect(c.monthly_rent).toBe(1200);
    expect(c.deposit).toBe(2400);
    expect(c.contract_type).toBe('Individual');
  });

  it('maps "Vigente" status → active', () => {
    const c = normalizeContract(makeContractRecord(), ORG_ID);
    expect(c.status).toBe('active');
  });

  it('maps "Activo" status → active', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.STATUS]: 'Activo' }), ORG_ID);
    expect(c.status).toBe('active');
  });

  it('maps "Finalizado" status → terminated', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.STATUS]: 'Finalizado' }), ORG_ID);
    expect(c.status).toBe('terminated');
  });

  it('maps unknown status → terminated (safe CHECK-compliant default)', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.STATUS]: 'Pendiente' }), ORG_ID);
    expect(c.status).toBe('terminated');
  });

  it('extracts tenant ext id from "👤 Residentes" emoji field', () => {
    const c = normalizeContract(makeContractRecord(), ORG_ID);
    expect(c._airtable_tenant_ext_id).toBe('recTENANT001');
  });

  it('extracts unit ext id from "Habitacion" field', () => {
    const c = normalizeContract(makeContractRecord(), ORG_ID);
    expect(c._airtable_unit_ext_id).toBe('recUNIT001');
  });

  it('returns null tenant ext id when "👤 Residentes" is absent', () => {
    const c = normalizeContract(makeContractRecord({ '👤 Residentes': undefined }), ORG_ID);
    expect(c._airtable_tenant_ext_id).toBeNull();
  });

  it('returns null unit ext id when "Habitacion" is absent', () => {
    const c = normalizeContract(makeContractRecord({ Habitacion: undefined }), ORG_ID);
    expect(c._airtable_unit_ext_id).toBeNull();
  });

  it('extracts receipt URL from Const. garantía attachment', () => {
    const c = normalizeContract(
      makeContractRecord({
        [CONTRACT_FIELD.DEPOSIT_RECEIPT_URL]: [{ url: 'https://example.com/receipt.pdf', id: 'att1' }],
      }),
      ORG_ID
    );
    expect(c.deposit_receipt_url).toBe('https://example.com/receipt.pdf');
  });

  it('sets deposit_receipt_url null when attachment is empty', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.DEPOSIT_RECEIPT_URL]: [] }), ORG_ID);
    expect(c.deposit_receipt_url).toBeNull();
  });

  it('handles missing optional fields gracefully', () => {
    const c = normalizeContract(
      makeContractRecord({
        [CONTRACT_FIELD.END_DATE]: undefined,
        [CONTRACT_FIELD.MONTHLY_RENT]: undefined,
        [CONTRACT_FIELD.DEPOSIT]: undefined,
      }),
      ORG_ID
    );
    expect(c.end_date).toBeNull();
    expect(c.monthly_rent).toBeNull();
    expect(c.deposit).toBeNull();
  });

  it('sets tenant_id/unit_id null (resolved downstream)', () => {
    const c = normalizeContract(makeContractRecord(), ORG_ID);
    expect(c.tenant_id).toBeNull();
    expect(c.unit_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapContractStatus
// ---------------------------------------------------------------------------

describe('mapContractStatus', () => {
  it('maps all active variants', () => {
    for (const v of ['Activo', 'Active', 'ACTIVO', 'Vigente', 'VIGENTE']) {
      expect(mapContractStatus(v)).toBe('active');
    }
  });

  it('maps all ended variants → terminated', () => {
    for (const v of ['Inactivo', 'Inactive', 'Finalizado', 'Terminado']) {
      expect(mapContractStatus(v)).toBe('terminated');
    }
  });

  it('maps unknown value → terminated (DB CHECK only allows active/expired/terminated)', () => {
    expect(mapContractStatus('Pendiente')).toBe('terminated');
  });

  it('maps null/undefined → active (DB default)', () => {
    expect(mapContractStatus(null)).toBe('active');
    expect(mapContractStatus(undefined)).toBe('active');
  });
});

describe('toIsoDate via normalizeContract date fields', () => {
  it('converts locale formula date "26/3/2027" to ISO', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.END_DATE]: '26/3/2027' }), ORG_ID);
    expect(c.end_date).toBe('2027-03-26');
  });

  it('passes through ISO dates unchanged', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.START_DATE]: '2026-01-15' }), ORG_ID);
    expect(c.start_date).toBe('2026-01-15');
  });

  it('returns null for unparseable date strings', () => {
    const c = normalizeContract(makeContractRecord({ [CONTRACT_FIELD.END_DATE]: 'sin fecha' }), ORG_ID);
    expect(c.end_date).toBeNull();
  });
});
