import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { PropertyComparisonTable } from '@/components/properties/PropertyComparisonTable';
import { PropertyGroupForm } from '@/components/property-groups/PropertyGroupForm';
import { RemovePropertyGroupButton } from '@/components/property-groups/RemovePropertyGroupButton';
import { todayStr } from '@/lib/notifications/reminder-engine';
import { compareProperties, listPropertyOptions, windowStart } from '@/lib/properties/comparison';
import { listPropertyGroups, sumComparisons } from '@/lib/property-groups/queries';

export const metadata: Metadata = { title: 'Property groups' };

export default async function PropertyGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const { group: selectedId } = await searchParams;
  const [t, groups, options] = await Promise.all([
    getTranslations('propertyGroups'),
    listPropertyGroups(ctx.orgId),
    listPropertyOptions(ctx.orgId),
  ]);
  const selected = groups.find((g) => g.id === selectedId);
  const report = selected
    ? await compareProperties(ctx.orgId, selected.members.map((m) => m.id), windowStart(todayStr()))
    : [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-900">← {t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newGroup')}</h2>
        <PropertyGroupForm properties={options} />
      </Card>

      <Card padding="md">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{g.name}</p>
                  <p className="text-slate-500">{g.members.map((m) => m.name).join(', ')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/dashboard/properties/groups?group=${g.id}`} className="text-sm text-brand-600 hover:underline">{t('viewReport')}</Link>
                  <RemovePropertyGroupButton id={g.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">{t('reportTitle', { name: selected.name })}</h2>
          <PropertyComparisonTable rows={report} totals={{ label: t('total'), metrics: sumComparisons(report) }} />
        </section>
      )}
    </div>
  );
}
