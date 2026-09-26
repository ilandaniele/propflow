/**
 * Plain KPI tile — no prior-period delta (unlike finance's KpiTile), since
 * ChannelMetrics has no comparison period. Same visual language as the rest
 * of the dashboard (Card + uppercase label + large value).
 */

export function MetricTile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold ${warn ? 'text-amber-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
