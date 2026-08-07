/**
 * Pure tax-receipt (comprobantes) KPI aggregation.
 *
 * Extracted so the tax math (IGV/base/total over ISSUED receipts) is unit-tested.
 * Callers must pass every receipt row — never a `.limit()`-capped set.
 */

export interface TaxReceiptKpiRow {
  status?: string | null;
  totalAmount?: string | number | null;
  baseAmount?: string | number | null;
  igvAmount?: string | number | null;
  tipo?: string | null;
  mes?: number | string | null;
  anio?: number | string | null;
}

export interface TaxReceiptKpis {
  issuedCount: number;
  cancelledCount: number;
  draftCount: number;
  /** Totals are over ISSUED receipts only (cancelled/draft excluded). */
  totalAmount: number;
  totalBase: number;
  totalIGV: number;
  /** {count,total} per receipt type, across all statuses. */
  byType: Record<string, { count: number; total: number }>;
  /** issued total per YYYY-MM (rows with both mes and anio). */
  byMonth: Record<string, number>;
}

export function computeTaxReceiptKpis(rows: TaxReceiptKpiRow[]): TaxReceiptKpis {
  const issued = rows.filter((r) => r.status === 'issued');

  const byType: Record<string, { count: number; total: number }> = {};
  for (const r of rows) {
    const key = r.tipo ?? 'other';
    if (!byType[key]) byType[key] = { count: 0, total: 0 };
    byType[key].count += 1;
    byType[key].total += Number(r.totalAmount ?? 0);
  }

  const byMonth: Record<string, number> = {};
  for (const r of issued) {
    if (r.mes && r.anio) {
      const k = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
      byMonth[k] = (byMonth[k] ?? 0) + Number(r.totalAmount ?? 0);
    }
  }

  return {
    issuedCount: issued.length,
    cancelledCount: rows.filter((r) => r.status === 'cancelled').length,
    draftCount: rows.filter((r) => r.status === 'draft').length,
    totalAmount: issued.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0),
    totalBase: issued.reduce((s, r) => s + Number(r.baseAmount ?? 0), 0),
    totalIGV: issued.reduce((s, r) => s + Number(r.igvAmount ?? 0), 0),
    byType,
    byMonth,
  };
}
