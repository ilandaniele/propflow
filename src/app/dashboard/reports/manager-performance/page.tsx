import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { PERIOD_DAYS, parsePeriodDays } from '@/lib/reports/manager-performance';
import { loadManagerPerformance } from '@/lib/reports/manager-performance-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Manager performance' };

export default async function ManagerPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const days = parsePeriodDays((await searchParams).days);
  const [t, report] = await Promise.all([getTranslations('managerPerformance'), loadManagerPerformance(ctx.orgId, days)]);
  const formatDays = (value: number | null) => (value === null ? '—' : t('days', { count: value }));

  const tiles = [
    { label: t('assigned'), value: String(report.totals.assigned) },
    { label: t('resolved'), value: String(report.totals.resolved) },
    { label: t('open'), value: String(report.totals.open) },
    { label: t('avgResolution'), value: formatDays(report.totals.avgResolutionDays) },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <nav aria-label={t('periodNav')} className="flex items-center gap-2 text-sm">
        {PERIOD_DAYS.map((option) => (
          <Link
            key={option}
            href={`?days=${option}`}
            aria-current={option === days ? 'page' : undefined}
            className={option === days
              ? 'rounded-lg bg-brand-50 px-3 py-1.5 font-medium text-brand-700'
              : 'rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100'}
          >
            {t('lastDays', { count: option })}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{tile.label}</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>

      <Card padding="md">
        {report.managers.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4 font-medium">{t('manager')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t('assigned')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t('resolved')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t('open')}</th>
                  <th className="py-2 font-medium text-right">{t('avgResolution')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.managers.map((row) => (
                  <tr key={row.profileId}>
                    <td className="py-2 pr-4 text-slate-900">{row.name || t('unnamed')}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.assigned}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.resolved}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.open}</td>
                    <td className="py-2 text-right tabular-nums">{formatDays(row.avgResolutionDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">{t('note')}</p>
    </div>
  );
}
