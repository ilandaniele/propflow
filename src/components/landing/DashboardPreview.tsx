import { useTranslations } from 'next-intl';

interface KpiCardProps {
  label: string;
  value: string;
  colorClass: string;
}

function KpiCard({ label, value, colorClass }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 mb-1 leading-tight">{label}</p>
      <p className={`text-lg font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

export function DashboardPreview() {
  const t = useTranslations('landing.dashboard');

  // Static mock KPI data — no real data, purely presentational
  const kpis = [
    { labelKey: 'kpis.trueNetProfit' as const, value: '$8.240', colorClass: 'text-green-600' },
    { labelKey: 'kpis.occupancy' as const, value: '91%', colorClass: 'text-brand-600' },
    { labelKey: 'kpis.openIncidents' as const, value: '3', colorClass: 'text-amber-600' },
    { labelKey: 'kpis.pendingTasks' as const, value: '7', colorClass: 'text-blue-600' },
    { labelKey: 'kpis.overdueBalance' as const, value: '$1.200', colorClass: 'text-red-600' },
    { labelKey: 'kpis.belowCostRooms' as const, value: '2', colorClass: 'text-orange-600' },
  ];

  return (
    <div
      className="mt-16 relative mx-auto max-w-4xl"
      aria-label={t('title')}
      data-testid="dashboard-preview"
    >
      <div className="rounded-2xl border border-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden bg-slate-50">
        {/* Mock browser chrome */}
        <div className="h-9 bg-white border-b border-slate-200 flex items-center px-4 gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4 h-5 bg-slate-100 rounded text-xs text-slate-400 flex items-center px-2">
            {t('urlBar')}
          </div>
        </div>

        {/* KPI grid */}
        <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {kpis.map(({ labelKey, value, colorClass }) => (
            <KpiCard
              key={labelKey}
              label={t(labelKey)}
              value={value}
              colorClass={colorClass}
            />
          ))}
        </div>

        {/* Mini chart bar — purely decorative */}
        <div className="px-6 pb-6" aria-hidden="true">
          <div className="h-24 bg-white rounded-xl border border-slate-200 p-3 flex items-end gap-1.5">
            {[40, 65, 55, 80, 70, 90, 75, 85, 60, 95, 78, 88].map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-sm bg-gradient-to-t opacity-70 ${
                  i % 2 === 0
                    ? 'from-brand-700 to-brand-500'
                    : 'from-brand-500 to-brand-300'
                }`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
