import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { IncidentCategoryLabel } from '@/components/incidents/IncidentCategoryLabel';
import { loadMaintenanceStats } from '@/lib/incidents/stats';

export const metadata: Metadata = { title: 'Maintenance stats' };

export default async function MaintenanceStatsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, stats] = await Promise.all([
    getTranslations('maintenanceStats'),
    loadMaintenanceStats(ctx.orgId),
  ]);
  const days = (value: number | null) => (value == null ? '—' : t('days', { count: value }));

  const tiles = [
    { label: t('total'), value: String(stats.total) },
    { label: t('open'), value: String(stats.open) },
    { label: t('solved'), value: String(stats.solved) },
    { label: t('avgResolution'), value: days(stats.avgResolutionDays) },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/incidents" className="text-sm text-brand-600 hover:underline">{t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{tile.label}</p>
            <p className="text-xl font-bold text-slate-900">{tile.value}</p>
          </div>
        ))}
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-3">{t('byProperty')}</h2>
        {stats.byProperty.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">{t('property')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t('total')}</th>
                  <th className="py-2 pr-4 font-medium text-right">{t('open')}</th>
                  <th className="py-2 font-medium text-right">{t('avgResolution')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byProperty.map((row) => (
                  <tr key={row.propertyId ?? 'none'}>
                    <td className="py-2 pr-4 text-slate-900">{row.propertyName ?? t('noProperty')}</td>
                    <td className="py-2 pr-4 text-right">{row.total}</td>
                    <td className="py-2 pr-4 text-right">{row.open}</td>
                    <td className="py-2 text-right">{days(row.avgResolutionDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-3">{t('byCategory')}</h2>
        {stats.byCategory.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {stats.byCategory.map((row) => (
              <li key={row.category} className="flex justify-between py-2">
                <span className="text-slate-700"><IncidentCategoryLabel category={row.category} /></span>
                <span className="font-medium text-slate-900">{row.total}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
