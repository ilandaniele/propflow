import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { formatMoney } from '@/lib/finance/currency';
import { loadAverageRent } from '@/lib/reports/average-rent-query';
import type { AverageRentGroup } from '@/lib/reports/average-rent';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Average rent' };

type Labels = { group: string; contracts: string; average: string };

function GroupTable<T extends AverageRentGroup>({ title, labels, currency, rows, label }: {
  title: string;
  labels: Labels;
  currency: string;
  rows: T[];
  label: (row: T) => string;
}) {
  return (
    <Card padding="md">
      <h3 className="text-sm font-medium text-slate-700 mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-4 font-medium">{labels.group}</th>
              <th className="py-2 pr-4 font-medium text-right">{labels.contracts}</th>
              <th className="py-2 font-medium text-right">{labels.average}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key ?? 'none'}>
                <td className="py-2 pr-4 text-slate-900">{label(row)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.contracts}</td>
                <td className="py-2 text-right tabular-nums font-medium">{formatMoney(currency, row.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default async function AverageRentPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, report] = await Promise.all([getTranslations('averageRent'), loadAverageRent(ctx.orgId)]);
  const labels = { group: t('group'), contracts: t('contracts'), average: t('average') };
  const unspecified = t('unspecified');

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {report.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : report.map((section) => (
        <section key={section.currency} className="space-y-4" aria-label={section.currency}>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('overall', { currency: section.currency })}</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{formatMoney(section.currency, section.overall.average)}</p>
            <p className="text-xs text-slate-500 mt-1">{t('contractCount', { count: section.overall.contracts })}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <GroupTable
              title={t('byProperty')}
              labels={labels}
              currency={section.currency}
              rows={section.byProperty}
              label={(row) => row.propertyName}
            />
            <GroupTable title={t('byUnitType')} labels={labels} currency={section.currency} rows={section.byUnitType} label={(row) => row.key ?? unspecified} />
            <GroupTable
              title={t('byBedrooms')}
              labels={labels}
              currency={section.currency}
              rows={section.byBedrooms}
              label={(row) => (row.key === null ? unspecified : t('bedrooms', { count: Number(row.key) }))}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
