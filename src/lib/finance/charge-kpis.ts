/**
 * Pure additional-charges KPI aggregation for the dashboard.
 *
 * Extracted so the money math is unit-tested (see PR #50/#53). Callers must pass
 * EVERY charge row for the org — never a `.limit()`-capped set — or the totals
 * understate. Fallback labels are injected to keep this i18n-free and testable.
 */

export interface ChargeKpiRow {
  amount: string | number | null;
  description?: string | null;
  mes?: number | string | null;
  anio?: number | string | null;
  tenantFullName?: string | null;
  contractId?: string | null;
}

export interface ChargeKpis {
  totalAmount: number;
  /** amount per concept/description (missing → noDescription label). */
  byDescription: Record<string, number>;
  /** amount per YYYY-MM bucket, only for rows that have both mes and anio. */
  byMonth: Record<string, number>;
  /** {name,total} per contract (or tenant name when no contract id). */
  byTenant: Record<string, { name: string; total: number }>;
}

export function computeChargeKpis(
  rows: ChargeKpiRow[],
  labels: { noDescription: string; unknownTenant: string },
): ChargeKpis {
  let totalAmount = 0;
  const byDescription: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  const byTenant: Record<string, { name: string; total: number }> = {};

  for (const r of rows) {
    const amt = Number(r.amount ?? 0);
    totalAmount += amt;

    const desc = r.description ?? labels.noDescription;
    byDescription[desc] = (byDescription[desc] ?? 0) + amt;

    if (r.mes && r.anio) {
      const key = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] ?? 0) + amt;
    }

    const name = r.tenantFullName ?? labels.unknownTenant;
    const id = r.contractId ?? name;
    if (!byTenant[id]) byTenant[id] = { name, total: 0 };
    byTenant[id].total += amt;
  }

  return { totalAmount, byDescription, byMonth, byTenant };
}
