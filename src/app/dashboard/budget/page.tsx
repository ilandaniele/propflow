import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listBudgetCategories, spendByCategoryMonth } from '@/lib/finance/budget';
import { budgetRows, monthsElapsed } from '@/lib/finance/budget-math';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { BudgetAmountForm } from './BudgetAmountForm';

export const metadata: Metadata = { title: 'Budget' };

const YEAR_RE = /^\d{4}$/;
const navClasses = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50';

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('budget');
  const now = new Date();
  const raw = (await searchParams).year;
  const year = raw && YEAR_RE.test(raw) ? Number(raw) : now.getUTCFullYear();

  const [categories, spend] = await Promise.all([listBudgetCategories(ctx.orgId, year), spendByCategoryMonth(ctx.orgId, year)]);
  const elapsed = monthsElapsed(year, now);
  const rows = budgetRows(categories, spend, elapsed);
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle', { months: elapsed })}</p>
        </div>
        <nav className="flex items-center gap-2" aria-label={t('yearNav')}>
          <Link href={`/dashboard/budget?year=${year - 1}`} className={navClasses}>{t('previous')}</Link>
          <span className="text-sm font-semibold text-slate-700 tabular-nums">{year}</span>
          <Link href={`/dashboard/budget?year=${year + 1}`} className={navClasses}>{t('next')}</Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
          <div className="mt-3 text-center">
            <Link href="/dashboard/finance/expenses/categories" className="text-sm font-medium text-slate-700 hover:underline">{t('manageCategories')}</Link>
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colCategory')}</th>
                <th className="text-right px-4 py-3">{t('colAnnual')}</th>
                <th className="text-right px-4 py-3">{t('colBudgetToDate')}</th>
                <th className="text-right px-4 py-3">{t('colActualToDate')}</th>
                <th className="text-right px-4 py-3">{t('colVariance')}</th>
                <th className="text-right px-4 py-3">{t('colExecuted')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const label = row.name ?? t('uncategorized');
                return (
                  <tr key={row.categoryId ?? 'none'}>
                    <td className="px-4 py-3 font-medium text-slate-900">{label}</td>
                    <td className="px-4 py-3 text-right">
                      {row.categoryId
                        ? <BudgetAmountForm categoryId={row.categoryId} year={year} amount={row.annualBudget} label={label} />
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.budgetToDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.actualToDate)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${row.variance < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {formatMoney(row.variance)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.executedPct === null ? '—' : `${row.executedPct}%`}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-3">{t('total')}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.annualBudget))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.budgetToDate))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.actualToDate))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.variance))}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
