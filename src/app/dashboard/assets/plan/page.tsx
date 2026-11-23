import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listAssetTasks, logsForYear } from '@/lib/assets/assets';
import { annualCost, doneMonths, plannedMonths } from '@/lib/assets/maintenance-math';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Maintenance plan' };

const MONTHS = Array.from({ length: 12 }, (_, month) => month);

function cellClass(planned: boolean, done: boolean) {
  if (done) return 'bg-green-100 text-green-800';
  if (planned) return 'bg-amber-50 text-amber-800';
  return 'text-slate-300';
}

export default async function MaintenancePlanPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('assets.plan');
  const { year: rawYear } = await searchParams;
  const currentYear = Number(new Date().toISOString().slice(0, 4));
  const parsedYear = Number(rawYear);
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : currentYear;

  const [tasks, logs] = await Promise.all([listAssetTasks(ctx.orgId), logsForYear(ctx.orgId, year)]);
  const doneByTask = new Map<string, string[]>();
  for (const entry of logs) doneByTask.set(entry.taskId, [...(doneByTask.get(entry.taskId) ?? []), entry.doneOn]);

  const rows = tasks.map((task) => {
    const planned = new Set(plannedMonths(task.startsOn, task.frequencyMonths, year));
    const done = new Set(doneMonths(doneByTask.get(task.id) ?? [], year));
    return { ...task, planned, done, total: annualCost(task.estimatedCost, planned.size) };
  });
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const monthLabel = (month: number) => t(`months.${month}`);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/assets" className="text-sm text-slate-500 hover:underline">{t('back')}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title', { year })}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <nav className="flex gap-3 text-sm font-medium text-slate-700" aria-label={t('yearNav')}>
          <Link href={`/dashboard/assets/plan?year=${year - 1}`} className="hover:underline">← {year - 1}</Link>
          <Link href={`/dashboard/assets/plan?year=${year + 1}`} className="hover:underline">{year + 1} →</Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title', { year })}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-3 py-3">{t('colTask')}</th>
                <th className="text-left px-3 py-3">{t('colResponsible')}</th>
                {MONTHS.map((month) => <th key={month} className="px-1 py-3 text-center">{monthLabel(month)}</th>)}
                <th className="text-right px-3 py-3">{t('colTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/assets/${row.assetId}`} className="font-medium text-slate-900 hover:underline">{row.title}</Link>
                    <span className="block text-xs text-slate-500">{row.assetName} · {t('everyMonths', { count: row.frequencyMonths })}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{[row.responsible, row.supplier].filter(Boolean).join(' · ') || '—'}</td>
                  {MONTHS.map((month) => {
                    const planned = row.planned.has(month);
                    const done = row.done.has(month);
                    const label = done ? t('done') : planned ? t('planned') : '';
                    return (
                      <td key={month} className={`px-1 py-2 text-center text-xs ${cellClass(planned, done)}`} title={label}>
                        {done ? '✓' : planned ? '●' : '·'}
                        {label && <span className="sr-only">{monthLabel(month)}: {label}</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.total ? `S/ ${row.total.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-3" colSpan={14}>{t('grandTotal')}</td>
                <td className="px-3 py-3 text-right tabular-nums">S/ {grandTotal.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">{t('legend')}</p>
    </div>
  );
}
