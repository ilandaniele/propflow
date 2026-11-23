import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { RecurringExpenseForm } from '@/components/recurring-expenses/RecurringExpenseForm';
import { RecurringExpenseActions } from '@/components/recurring-expenses/RecurringExpenseActions';
import { GenerateRecurringButton } from '@/components/recurring-expenses/GenerateRecurringButton';
import { listFormOptions, listRecurringExpenses } from '@/lib/recurring-expenses/queries';
import { currentPeriod } from '@/lib/recurring-expenses/period';

export const metadata: Metadata = { title: 'Recurring expenses' };

export default async function RecurringExpensesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, rows, options] = await Promise.all([
    getTranslations('recurringExpenses'),
    listRecurringExpenses(ctx.orgId),
    listFormOptions(ctx.orgId),
  ]);
  const period = currentPeriod();

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/finance" className="text-sm text-brand-600 hover:underline">{t('back')}</Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-1">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addTitle')}</h2>
        <RecurringExpenseForm properties={options.properties} categories={options.categories} />
      </Card>

      <Card padding="md">
        <div className="mb-4">
          <GenerateRecurringButton period={period} />
          <p className="text-xs text-slate-500 mt-2">{t('generateHint')}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className={row.active ? 'font-medium text-slate-900' : 'font-medium text-slate-400'}>
                    {row.description} · S/ {Number(row.amount).toFixed(2)}
                  </p>
                  <p className="text-slate-500">
                    {t('everyMonth', { day: row.dayOfMonth })}
                    {row.propertyName && ` · ${row.propertyName}`}
                    {row.categoryName && ` · ${row.categoryName}`}
                    {' · '}
                    {row.lastPeriod ? t('lastPeriod', { period: row.lastPeriod }) : t('neverGenerated')}
                    {!row.active && ` · ${t('paused')}`}
                  </p>
                </div>
                <RecurringExpenseActions id={row.id} active={row.active} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
