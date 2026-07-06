'use client';

/**
 * src/components/portfolio/AirtableOccupancyDelta.tsx
 *
 * Client component — shows occupancy delta vs latest Airtable snapshot.
 * Renders nothing if no airtable_snapshots rows exist for the org.
 *
 * Receives snapshot data as a prop (fetched server-side by the parent
 * Server Component) so it has no direct DB access.
 */

export interface OccupancySnapshot {
  /** occupancy rate from Airtable snapshot, expressed as 0–1 fraction */
  occupancyRate: number;
  /** ISO date when the snapshot was last synced */
  syncedAt: string;
}

export interface AirtableOccupancyDeltaProps {
  /** Live occupancy rate computed from the database (0–1 fraction) */
  liveRate: number;
  /** Latest Airtable KPI snapshot, or null when no snapshot exists */
  snapshot: OccupancySnapshot | null;
}

export function AirtableOccupancyDelta({ liveRate, snapshot }: AirtableOccupancyDeltaProps) {
  // Graceful empty state — renders nothing when no snapshot available
  if (snapshot === null) return null;

  const delta = liveRate - snapshot.occupancyRate;
  const deltaPoints = Math.round(delta * 1000) / 10; // percentage points, 1 decimal
  const positive = deltaPoints >= 0;

  const syncDate = new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(snapshot.syncedAt));

  return (
    <div
      data-testid="airtable-occupancy-delta"
      className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Delta vs Airtable
      </p>
      <p
        className={`text-2xl font-bold mb-1 ${
          positive ? 'text-green-700' : 'text-red-600'
        }`}
      >
        {positive ? '+' : ''}
        {deltaPoints.toFixed(1)} pp
      </p>
      <p className="text-xs text-slate-400">
        Airtable: {(snapshot.occupancyRate * 100).toFixed(1)}% — Portal: {(liveRate * 100).toFixed(1)}%
      </p>
      <p className="text-xs text-slate-300 mt-1">Snapshot: {syncDate}</p>
    </div>
  );
}
