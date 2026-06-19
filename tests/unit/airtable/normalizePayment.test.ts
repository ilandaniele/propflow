/**
 * tests/unit/airtable/normalizePayment.test.ts
 *
 * Unit tests for normalizePayment — new base schema (Movimientos table).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePayment,
  buildPeriodMonth,
  mapPaymentMethod,
  mapPaymentStatus,
  PAYMENT_FIELD,
} from '@/lib/airtable/normalizers/normalizePayment';
import type { AirtableRecord } from '@/lib/schemas/airtable';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';

function makePaymentRecord(overrides: Partial<AirtableRecord['fields']> = {}): AirtableRecord {
  return {
    id: 'recMOVIMIENTO01',
    createdTime: '2026-01-01T00:00:00.000Z',
    fields: {
      [PAYMENT_FIELD.DUE_DATE]:         '2026-03-05',
      [PAYMENT_FIELD.PAID_DATE]:        '2026-03-04',
      [PAYMENT_FIELD.AMOUNT_DEPOSITED]: 1200,
      [PAYMENT_FIELD.MES]:              'Marzo',
      [PAYMENT_FIELD.AÑO]:              '2026',
      [PAYMENT_FIELD.METHOD]:           'Yape',
      [PAYMENT_FIELD.STATUS]:           'Pagado',
      [PAYMENT_FIELD.TENANT_NAME]:      'Juan García',
      // Contract link — actual Airtable field name (no emoji)
      'Historial (Contratos)':          ['recCONTRACT01'],
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('normalizePayment — Movimientos schema', () => {
  it('returns skip=false for a valid record', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    expect(result.skip).toBe(false);
  });

  it('maps amount from Monto depositado (S/)', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.amount).toBe(1200);
  });

  it('falls back to Monto renta (S/) when Monto depositado missing', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.AMOUNT_DEPOSITED]: undefined,
        [PAYMENT_FIELD.AMOUNT_RENT]:      900,
      }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.amount).toBe(900);
  });

  it('skips when all amount fields are absent', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.AMOUNT_DEPOSITED]: undefined,
        [PAYMENT_FIELD.AMOUNT_TOTAL]:     undefined,
        [PAYMENT_FIELD.AMOUNT_RENT]:      undefined,
      }),
      ORG_ID
    );
    expect(result.skip).toBe(true);
  });

  it('skips when all amounts are 0', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.AMOUNT_DEPOSITED]: 0,
        [PAYMENT_FIELD.AMOUNT_TOTAL]:     0,
        [PAYMENT_FIELD.AMOUNT_RENT]:      0,
      }),
      ORG_ID
    );
    expect(result.skip).toBe(true);
  });

  it('falls back to Monto total (S/) when Monto depositado missing', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.AMOUNT_DEPOSITED]: undefined,
        [PAYMENT_FIELD.AMOUNT_TOTAL]:     90,
        [PAYMENT_FIELD.AMOUNT_RENT]:      0,
      }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.amount).toBe(90);
  });

  it('uses Fecha de pago as paid_at', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.paid_at).toBe('2026-03-04');
  });

  it('falls back to Fecha de vencimiento when Fecha de pago absent', () => {
    const result = normalizePayment(
      makePaymentRecord({ [PAYMENT_FIELD.PAID_DATE]: undefined }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.paid_at).toBe('2026-03-05');
  });

  it('skips when both dates are absent', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.DUE_DATE]:  undefined,
        [PAYMENT_FIELD.PAID_DATE]: undefined,
      }),
      ORG_ID
    );
    expect(result.skip).toBe(true);
  });

  it('parses Spanish month "Marzo" + year "2026" → "2026-03"', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.period_month).toBe('2026-03');
  });

  it('parses Spanish month "Enero" → "2026-01"', () => {
    const result = normalizePayment(
      makePaymentRecord({ [PAYMENT_FIELD.MES]: 'Enero', [PAYMENT_FIELD.AÑO]: '2026' }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.period_month).toBe('2026-01');
  });

  it('parses numeric month "3" → "2026-03"', () => {
    const result = normalizePayment(
      makePaymentRecord({ [PAYMENT_FIELD.MES]: '3', [PAYMENT_FIELD.AÑO]: '2026' }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.period_month).toBe('2026-03');
  });

  it('extracts contract ext id from "Historial (Contratos)" field', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment._airtable_contract_ext_id).toBe('recCONTRACT01');
  });

  it('maps method "Yape" → transfer', () => {
    const result = normalizePayment(makePaymentRecord({ [PAYMENT_FIELD.METHOD]: 'Yape' }), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.method).toBe('transfer');
  });

  it('maps status "Pagado" → approved', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.status).toBe('approved');
  });

  it('maps unknown status → pending', () => {
    const result = normalizePayment(
      makePaymentRecord({ [PAYMENT_FIELD.STATUS]: 'Pendiente' }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.status).toBe('pending');
  });

  it('extracts receipt URL from Comprobante attachment', () => {
    const result = normalizePayment(
      makePaymentRecord({
        [PAYMENT_FIELD.RECEIPT]: [{ url: 'https://example.com/comp.pdf', id: 'att1' }],
      }),
      ORG_ID
    );
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.receipt_url).toBe('https://example.com/comp.pdf');
  });

  it('sets tenant_id/contract_id null (resolved downstream)', () => {
    const result = normalizePayment(makePaymentRecord(), ORG_ID);
    if (result.skip) throw new Error('should not skip');
    expect(result.payment.tenant_id).toBeNull();
    expect(result.payment.contract_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPeriodMonth
// ---------------------------------------------------------------------------

describe('buildPeriodMonth', () => {
  it('parses Spanish full name', () => {
    expect(buildPeriodMonth('Enero',      '2026')).toBe('2026-01');
    expect(buildPeriodMonth('Febrero',    '2026')).toBe('2026-02');
    expect(buildPeriodMonth('Diciembre',  '2026')).toBe('2026-12');
    expect(buildPeriodMonth('Septiembre', '2026')).toBe('2026-09');
    expect(buildPeriodMonth('Setiembre',  '2026')).toBe('2026-09');
  });

  it('parses numeric month strings', () => {
    expect(buildPeriodMonth('1',  '2026')).toBe('2026-01');
    expect(buildPeriodMonth('12', '2026')).toBe('2026-12');
  });

  it('returns raw concatenation for unparseable month', () => {
    const result = buildPeriodMonth('Quartember', '2026');
    expect(result).toContain('2026');
  });

  it('returns null when mes or año absent', () => {
    expect(buildPeriodMonth(undefined, '2026')).toBeNull();
    expect(buildPeriodMonth('Enero', undefined)).toBeNull();
    expect(buildPeriodMonth(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapPaymentMethod
// ---------------------------------------------------------------------------

describe('mapPaymentMethod', () => {
  it('maps cash variants', () => {
    expect(mapPaymentMethod('Efectivo')).toBe('cash');
    expect(mapPaymentMethod('Cash')).toBe('cash');
  });

  it('maps transfer variants', () => {
    expect(mapPaymentMethod('Transferencia')).toBe('transfer');
    expect(mapPaymentMethod('Yape')).toBe('transfer');
    expect(mapPaymentMethod('Plin')).toBe('transfer');
    expect(mapPaymentMethod('Depósito')).toBe('transfer');
  });

  it('defaults unknown to transfer', () => {
    expect(mapPaymentMethod('Cripto')).toBe('transfer');
    expect(mapPaymentMethod(null)).toBe('transfer');
    expect(mapPaymentMethod(undefined)).toBe('transfer');
  });
});

// ---------------------------------------------------------------------------
// mapPaymentStatus
// ---------------------------------------------------------------------------

describe('mapPaymentStatus', () => {
  it('maps paid-ish values to approved', () => {
    expect(mapPaymentStatus('Pagado')).toBe('approved');
    expect(mapPaymentStatus('Completo')).toBe('approved');
    expect(mapPaymentStatus('Aprobado')).toBe('approved');
  });

  it('defaults unknown values to pending', () => {
    expect(mapPaymentStatus('Pendiente')).toBe('pending');
    expect(mapPaymentStatus(null)).toBe('pending');
    expect(mapPaymentStatus(undefined)).toBe('pending');
  });
});
