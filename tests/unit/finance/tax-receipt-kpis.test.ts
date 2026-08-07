import { describe, it, expect } from 'vitest';
import { computeTaxReceiptKpis, type TaxReceiptKpiRow } from '@/lib/finance/tax-receipt-kpis';

const r = (o: Partial<TaxReceiptKpiRow>): TaxReceiptKpiRow => ({ status: 'issued', ...o });

describe('computeTaxReceiptKpis', () => {
  it('totals cover ISSUED receipts only (cancelled/draft excluded)', () => {
    const k = computeTaxReceiptKpis([
      r({ status: 'issued', totalAmount: '118', baseAmount: 100, igvAmount: '18' }),
      r({ status: 'issued', totalAmount: 59, baseAmount: '50', igvAmount: 9 }),
      r({ status: 'cancelled', totalAmount: 999, baseAmount: 999, igvAmount: 999 }),
      r({ status: 'draft', totalAmount: 999 }),
    ]);
    expect(k.totalAmount).toBe(177);
    expect(k.totalBase).toBe(150);
    expect(k.totalIGV).toBe(27);
    expect(k.issuedCount).toBe(2);
    expect(k.cancelledCount).toBe(1);
    expect(k.draftCount).toBe(1);
  });

  it('byType counts ALL statuses; byMonth is issued-only and padded', () => {
    const k = computeTaxReceiptKpis([
      r({ status: 'issued', tipo: 'factura', totalAmount: 100, mes: 3, anio: 2026 }),
      r({ status: 'cancelled', tipo: 'factura', totalAmount: 50 }),
      r({ status: 'issued', tipo: 'boleta', totalAmount: 20, mes: 12, anio: 2026 }),
    ]);
    expect(k.byType).toEqual({
      factura: { count: 2, total: 150 },
      boleta: { count: 1, total: 20 },
    });
    expect(k.byMonth).toEqual({ '2026-03': 100, '2026-12': 20 });
  });

  it('empty set → zeros / empty maps', () => {
    const k = computeTaxReceiptKpis([]);
    expect(k).toMatchObject({ issuedCount: 0, totalAmount: 0, totalBase: 0, totalIGV: 0 });
    expect(k.byType).toEqual({});
    expect(k.byMonth).toEqual({});
  });
});
