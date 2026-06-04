/**
 * src/components/finance/KpiTile.tsx
 *
 * KPI tile for the Financial Dashboard (AC22).
 * Server Component — pure presentational, no browser APIs.
 *
 * Shows: label, formatted value, optional delta vs prior period,
 * and optional sub-label. Color-coded for positive/negative values.
 */

export interface FinanceKpiTileProps {
  /** i18n-resolved label string */
  label: string;
  /** Formatted value string (e.g. "$1,234.56", "87.3%") */
  value: string;
  /** Raw numeric value — drives colour */
  rawValue: number;
  /**
   * Percentage delta vs prior period.
   * positive = improvement, negative = decline. null = no prior data.
   */
  delta?: number | null;
  /**
   * When true, a positive raw value renders green (e.g. profit, occupancy).
   * When false, a positive raw value renders red (e.g. past due balance, turn cost).
   */
  positiveIsGood?: boolean;
  /** Optional sub-label below the value */
  sub?: string;
  /** data-testid for the tile root */
  testId?: string;
  /** Translated suffix shown after the delta percentage, e.g. "% vs prior period" */
  deltaSuffix?: string;
  /** Translated label shown when delta is null, e.g. "No prior data" */
  noPriorData?: string;
}

export function KpiTile({
  label,
  value,
  rawValue,
  delta = null,
  positiveIsGood = true,
  sub,
  testId,
  deltaSuffix = '% vs prior period',
  noPriorData = 'No prior data',
}: FinanceKpiTileProps) {
  // Value colour
  const valueColor =
    rawValue > 0 && positiveIsGood
      ? 'text-green-700'
      : rawValue < 0 || (!positiveIsGood && rawValue > 0)
      ? 'text-red-600'
      : 'text-slate-700';

  // Delta colour
  let deltaColor = 'text-slate-400';
  if (delta !== null) {
    const isPositive = delta > 0;
    if (isPositive && positiveIsGood) deltaColor = 'text-green-600';
    else if (isPositive && !positiveIsGood) deltaColor = 'text-red-600';
    else if (!isPositive && positiveIsGood) deltaColor = 'text-red-600';
    else if (!isPositive && !positiveIsGood) deltaColor = 'text-green-600';
  }

  const showArrow = delta !== null && delta !== 0;
  const arrowUp = delta !== null && delta > 0;

  return (
    <article
      data-testid={testId}
      className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`text-2xl font-bold mb-1 ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mb-2">{sub}</p>}
      {delta !== null ? (
        <div className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
          {showArrow && (
            <span aria-hidden="true">{arrowUp ? '↑' : '↓'}</span>
          )}
          <span>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}{deltaSuffix}
          </span>
        </div>
      ) : (
        <p className="text-xs text-slate-300">{noPriorData}</p>
      )}
    </article>
  );
}
