import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { assetLogs, getAsset, listAssetTasks } from '@/lib/assets/assets';
import { taskSchedule } from '@/lib/assets/maintenance-math';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { DueBadge } from '../DueBadge';
import { TaskForm } from './TaskForm';
import { CompleteTaskForm } from './CompleteTaskForm';

export const metadata: Metadata = { title: 'Asset' };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('assets');
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

  const [asset, tasks, logs] = await Promise.all([
    getAsset(ctx.orgId, id),
    listAssetTasks(ctx.orgId, id),
    assetLogs(ctx.orgId, id),
  ]);
  if (!asset) notFound();

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/assets" className="text-sm text-slate-500 hover:underline">{t('back')}</Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{asset.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(`categories.${asset.category}`)} · {asset.propertyName}{asset.location ? ` · ${asset.location}` : ''}
        </p>
      </div>

      <TaskForm assetId={asset.id} today={today} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">{t('tasksTitle')}</h2>
        {tasks.length === 0 ? (
          <Card><EmptyState title={t('tasksEmptyTitle')} description={t('tasksEmptyDesc')} /></Card>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm" aria-label={t('tasksTitle')}>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">{t('colTask')}</th>
                  <th className="text-left px-4 py-3">{t('colFrequency')}</th>
                  <th className="text-left px-4 py-3">{t('colLastDone')}</th>
                  <th className="text-left px-4 py-3">{t('colNextDue')}</th>
                  <th className="text-right px-4 py-3"><span className="sr-only">{t('colActions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => {
                  const schedule = taskSchedule(task, today);
                  return (
                    <tr key={task.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-900">{task.title}</span>
                        <span className="block text-xs text-slate-500">
                          {[task.responsible, task.supplier, task.estimatedCost && `S/ ${task.estimatedCost}`].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t('everyMonths', { count: task.frequencyMonths })}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{task.lastDoneOn ?? '—'}</td>
                      <td className="px-4 py-3"><DueBadge status={schedule.status} due={schedule.due} /></td>
                      <td className="px-4 py-3"><CompleteTaskForm taskId={task.id} today={today} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">{t('historyTitle')}</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">{t('historyEmpty')}</p>
        ) : (
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {logs.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
                <span>
                  <span className="tabular-nums text-slate-500 mr-2">{entry.doneOn}</span>
                  <span className="font-medium text-slate-900">{entry.taskTitle}</span>
                  {entry.notes && <span className="block text-xs text-slate-500">{entry.notes}</span>}
                </span>
                {entry.cost && <span className="tabular-nums text-slate-600">S/ {entry.cost}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
