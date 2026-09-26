/**
 * Server-rendered CSS bar chart for the daily conversations trend (Phase
 * 8-9, item E) — no chart library, same "no new dependency" rule the
 * finance TrendChart follows, but simpler: this one needs no client-side
 * interactivity (no tooltip), so it stays a Server Component.
 */

const CHART_HEIGHT_PX = 96;

export interface DailyBarsDatum {
  day: string;
  conversations: number;
}

export function DailyBars({ data, noData }: { data: DailyBarsDatum[]; noData: string }) {
  if (data.length === 0 || data.every((d) => d.conversations === 0)) {
    return <p className="text-sm text-slate-400 py-8 text-center">{noData}</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.conversations));

  return (
    <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT_PX + 24 }}>
      {data.map((d) => {
        const heightPx = Math.max(2, Math.round((d.conversations / max) * CHART_HEIGHT_PX));
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.day}: ${d.conversations}`}>
            <div className="w-full bg-brand-500 rounded-t-sm" style={{ height: heightPx }} />
            <span className="text-[9px] text-slate-400 leading-none">{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}
