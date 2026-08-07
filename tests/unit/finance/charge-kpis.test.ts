import { describe, it, expect } from 'vitest';
import { computeChargeKpis, type ChargeKpiRow } from '@/lib/finance/charge-kpis';

const L = { noDescription: 'Sin descripción', unknownTenant: 'Desconocido' };

describe('computeChargeKpis', () => {
  it('sums total over ALL rows and buckets by description', () => {
    const rows: ChargeKpiRow[] = [
      { amount: '100', description: 'Limpieza', mes: 3, anio: 2026, tenantFullName: 'Ana', contractId: 'c1' },
      { amount: 50, description: 'Limpieza', mes: 3, anio: 2026, tenantFullName: 'Ana', contractId: 'c1' },
      { amount: '25.5', description: 'Agua', mes: 4, anio: 2026, tenantFullName: 'Bob', contractId: 'c2' },
    ];
    const k = computeChargeKpis(rows, L);
    expect(k.totalAmount).toBe(175.5);
    expect(k.byDescription).toEqual({ Limpieza: 150, Agua: 25.5 });
  });

  it('null amount → 0, null description → noDescription label', () => {
    const k = computeChargeKpis([{ amount: null, description: null }], L);
    expect(k.totalAmount).toBe(0);
    expect(k.byDescription).toEqual({ 'Sin descripción': 0 });
  });

  it('byMonth only buckets rows with both mes and anio; pads month', () => {
    const k = computeChargeKpis([
      { amount: 10, mes: 3, anio: 2026 },
      { amount: 20, mes: 12, anio: 2026 },
      { amount: 99, mes: null, anio: 2026 }, // missing mes → skipped
      { amount: 99, mes: 5, anio: null },    // missing anio → skipped
    ], L);
    expect(k.byMonth).toEqual({ '2026-03': 10, '2026-12': 20 });
  });

  it('byTenant groups by contractId, falling back to tenant name / unknown', () => {
    const k = computeChargeKpis([
      { amount: 100, tenantFullName: 'Ana', contractId: 'c1' },
      { amount: 40, tenantFullName: 'Ana', contractId: 'c1' },
      { amount: 30, tenantFullName: null, contractId: null }, // → unknown label as id+name
    ], L);
    expect(k.byTenant['c1']).toEqual({ name: 'Ana', total: 140 });
    expect(k.byTenant['Desconocido']).toEqual({ name: 'Desconocido', total: 30 });
  });

  it('empty set → zeros and empty maps', () => {
    const k = computeChargeKpis([], L);
    expect(k).toEqual({ totalAmount: 0, byDescription: {}, byMonth: {}, byTenant: {} });
  });
});
