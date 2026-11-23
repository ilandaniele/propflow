import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PropertyComparisonTable } from '@/components/properties/PropertyComparisonTable';
import { todayStr } from '@/lib/notifications/reminder-engine';
import {
  COMPARISON_WINDOW_MONTHS,
  MAX_COMPARED_PROPERTIES,
  compareProperties,
  listPropertyOptions,
  parseComparedIds,
  windowStart,
} from '@/lib/properties/comparison';

export const metadata: Metadata = { title: 'Compare properties' };

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
        <PropertyComparisonTable rows={rows} />
      )}
    </div>
  );
}
