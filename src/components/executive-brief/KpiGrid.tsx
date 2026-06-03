/**
 * KpiGrid — 4 KPI summary tiles for the Executive Brief page (AC12).
 *
 * Each tile shows:
 *   - Label (i18n)
 *   - Formatted value
 *   - Delta % vs prior period with colour-coded up/down arrow
 *
 * Tiles: Ocupación, Ganancia Neta MTD, Balance Vencido, Incidentes Abiertos
 *
 * This is a pure presentational Server Component — no browser APIs, no
 * useEffect. Data comes from the server component parent.
 */

export interface KpiTileData {
  key: string;
  label: string;
  value: string;
  /** Delta percentage (positive = improvement). e.g. 5.2 means +5.2% */
  delta: number | null;
  /** Whether a positive delta is visually "good" (green) or "bad" (red).
   *  true  → up arrow = green (e.g. occupancy, profit)
   *  false → up arrow = red   (e.g. past due balance, open incidents)
   */
  positiveIsGood: boolean;
  /** Raw numeric value — used for colour decisions */
  rawValue: number;
  /** Optional sub-label shown below the value */
  sub?: string;
}

interface KpiGridProps {
  tiles: KpiTileData[];
}

export function KpiGrid({ tiles }: KpiGridProps) {
  return (
    <div
      data-testid="kpi-grid"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {tiles.map((tile) => (
        <KpiTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}

function KpiTile({ tile }: { tile: KpiTileData }) {
  const { label, value, delta, positiveIsGood, sub } = tile;

  // Determine delta colour
  let deltaColor = 'text-slate-400';
  if (delta !== null) {
    const isPositiveDelta = delta > 0;
    if (isPositiveDelta && positiveIsGood) deltaColor = 'text-green-600';
    else if (isPositiveDelta && !positiveIsGood) deltaColor = 'text-red-600';
    else if (!isPositiveDelta && positiveIsGood) deltaColor = 'text-red-600';
    else if (!isPositiveDelta && !positiveIsGood) deltaColor = 'text-green-600';
  }

  const showArrow = delta !== null && delta !== 0;
  const arrowUp = delta !== null && delta > 0;

  // Value colour (green for positive, neutral for 0, red for negative)
  const valueColor =
    tile.rawValue > 0 && tile.positiveIsGood
      ? 'text-green-700'
      : tile.rawValue < 0 || (!tile.positiveIsGood && tile.rawValue > 0)
      ? 'text-red-600'
      : 'text-slate-700';

  return (
    <article
      data-testid={`kpi-tile-${tile.key}`}
      className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`text-2xl font-bold mb-1 ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mb-2">{sub}</p>}
      {delta !== null && (
        <div className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
          {showArrow && (
            <span aria-hidden="true">{arrowUp ? '↑' : '↓'}</span>
          )}
          <span>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}% vs periodo anterior
          </span>
        </div>
      )}
      {delta === null && (
        <p className="text-xs text-slate-300">Sin datos previos</p>
      )}
    </article>
  );
}
