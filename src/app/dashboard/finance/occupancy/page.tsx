import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { occupancyHistory } from '@/lib/finance/occupancy-history-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Occupancy history' };

const YearSchema = z.coerce.number().int().min(2000).max(2100).catch(() => new Date().getUTCFullYear());
const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

export default async function OccupancyHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const year = YearSchema.parse((await searchParams).year ?? new Date().getUTCFullYear());
  const [history, t] = await Promise.all([occupancyHistory(ctx.orgId, year), getTranslations('occupancyHistory')]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <nav aria-label={t('yearNav')} className="flex items-center gap-3 text-sm">
        <Link href={`?year=${year - 1}`} className="text-slate-600 underline">{year - 1}</Link>
        <span className="font-semibold text-slate-900 tabular-nums">{year}</span>
        <Link href={`?year=${year + 1}`} className="text-slate-600 underline">{year + 1}</Link>
      </nav>

      {history.properties.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <>
          <Card>
            <h2 className="text-sm font-medium text-slate-700 mb-4">{t('byMonth')}</h2>
            <ol className="grid grid-cols-12 items-end gap-2 h-48" aria-label={t('byMonth')}>
              {history.months.map((month) => (
                <li key={month.month} className="flex h-full flex-col items-center justify-end gap-1">
                  <span className="text-xs tabular-nums text-slate-600">{percent(month.rate)}</span>
                  <div className="w-full rounded-t bg-brand-600" style={{ height: `${Math.round((month.rate ?? 0) * 100)}%` }} />
                  <span className="text-xs text-slate-500">{month.month.slice(5)}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">{t('property')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('units')}</th>
                    {history.months.map((month) => <th key={month.month} className="py-2 px-1 font-medium text-right">{month.month.slice(5)}</th>)}
                    <th className="py-2 pl-2 font-medium text-right">{t('average')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.properties.map((property) => (
                    <tr key={property.propertyId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-slate-900">{property.propertyName}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{property.units}</td>
                      {property.rates.map((rate, index) => <td key={index} className="py-2 px-1 text-right tabular-nums text-slate-600">{percent(rate)}</td>)}
                      <td className="py-2 pl-2 text-right tabular-nums font-medium">{percent(property.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-slate-500">{t('note')}</p>
        </>
      )}
    </div>
  );
}
