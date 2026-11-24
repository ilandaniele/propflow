import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { todayStr } from '@/lib/notifications/reminder-engine';
import {
  COMPARISON_WINDOW_MONTHS,
  MAX_COMPARED_PROPERTIES,
  compareProperties,
  listPropertyOptions,
  parseComparedIds,
  windowStart,
  type PropertyComparison,
} from '@/lib/properties/comparison';

export const metadata: Metadata = { title: 'Compare properties' };

const money = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METRICS: { key: string; render: (row: PropertyComparison) => string }[] = [
  { key: 'units', render: (r) => `${r.occupiedUnits}/${r.totalUnits}` },
  { key: 'occupancy', render: (r) => `${r.occupancyPct}%` },
  { key: 'contractedRent', render: (r) => money(r.contractedRent) },
  { key: 'collected', render: (r) => money(r.collected) },
  { key: 'expenses', render: (r) => money(r.expenses) },
  { key: 'net', render: (r) => money(r.net) },
  { key: 'openIncidents', render: (r) => String(r.openIncidents) },
];

export default async function ComparePropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const selected = parseComparedIds((await searchParams).ids);
  const [t, options, rows] = await Promise.all([
    getTranslations('propertyComparison'),
    listPropertyOptions(ctx.orgId),
    compareProperties(ctx.orgId, selected, windowStart(todayStr())),
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-900">← {t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { max: MAX_COMPARED_PROPERTIES, months: COMPARISON_WINDOW_MONTHS })}</p>
      </div>

      <Card padding="md">
        <form method="get" className="space-y-3">
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="sr-only">{t('pick')}</legend>
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="ids" value={o.id} defaultChecked={selected.includes(o.id)} />
                {o.name}
              </label>
            ))}
          </fieldset>
          <Button type="submit">{t('compare')}</Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t('empty')}</p>
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th scope="col" className="px-4 py-3 font-medium text-slate-500">{t('metric')}</th>
                {rows.map((r) => <th key={r.id} scope="col" className="px-4 py-3 font-semibold text-slate-900">{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key} className="border-b border-slate-50 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal text-slate-600">{t(`metrics.${m.key}`)}</th>
                  {rows.map((r) => <td key={r.id} className="px-4 py-3 tabular-nums text-slate-900">{m.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
