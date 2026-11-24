import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listAssetTasks, listAssets, orgPropertyOptions } from '@/lib/assets/assets';
import { taskSchedule } from '@/lib/assets/maintenance-math';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssetForm } from './AssetForm';
import { DueBadge } from './DueBadge';

export const metadata: Metadata = { title: 'Assets' };

export default async function AssetsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('assets');
  const today = new Date().toISOString().slice(0, 10);
  const [rows, tasks, propertyOptions] = await Promise.all([
    listAssets(ctx.orgId),
    listAssetTasks(ctx.orgId),
    orgPropertyOptions(ctx.orgId),
  ]);

  const summary = new Map<string, { count: number; next: ReturnType<typeof taskSchedule> | null }>();
  for (const task of tasks) {
    const schedule = taskSchedule(task, today);
    const current = summary.get(task.assetId) ?? { count: 0, next: null };
    current.count += 1;
    if (!current.next || schedule.due < current.next.due) current.next = schedule;
    summary.set(task.assetId, current);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/dashboard/assets/plan" className="text-sm font-medium text-slate-700 hover:underline">{t('viewPlan')}</Link>
      </div>

      {propertyOptions.length > 0 && <AssetForm properties={propertyOptions} />}

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colName')}</th>
                <th className="text-left px-4 py-3">{t('colCategory')}</th>
                <th className="text-left px-4 py-3">{t('colProperty')}</th>
                <th className="text-right px-4 py-3">{t('colTasks')}</th>
                <th className="text-right px-4 py-3">{t('colNextDue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const info = summary.get(row.id);
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/dashboard/assets/${row.id}`} className="hover:underline">{row.name}</Link>
                      {row.location && <span className="block text-xs font-normal text-slate-500">{row.location}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t(`categories.${row.category}`)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.propertyName}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{info?.count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {info?.next ? <DueBadge status={info.next.status} due={info.next.due} /> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
