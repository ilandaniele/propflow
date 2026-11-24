import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { EXPENSE_KINDS } from '@/lib/schemas/finance';
import { listExpenseCategories, listMonthExpenses } from '@/lib/expenses/queries';
import { categoryOptions, totalsByKind } from '@/lib/expenses/categories';
import { resolveKind, resolveMonth } from '@/lib/expenses/filters';
import { CreateExpenseForm } from './CreateExpenseForm';

const formatMoney = (value: number) =>
  `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fieldClass = 'h-9 rounded border border-slate-300 px-2 text-sm';

function TotalTile({ label, value }: { label: string; value: number }) {
  return (
    <Card padding="md">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{formatMoney(value)}</p>
    </Card>
  );
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; kind?: string }> }) {
  const ctx = await requireAdmin();
  const t = await getTranslations('expenses');
  const params = await searchParams;
  const today = new Date();
  const month = resolveMonth(params.month, today);
  const kind = resolveKind(params.kind);

  const [categoryRows, propertyRows, rows] = await Promise.all([
    listExpenseCategories(ctx.orgId),
    db.select({ id: properties.id, label: properties.name }).from(properties)
      .where(eq(properties.orgId, ctx.orgId)).orderBy(asc(properties.name)),
    listMonthExpenses(ctx.orgId, month, kind),
  ]);
  const totals = totalsByKind(rows);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <Link href="/dashboard/finance/expenses/categories" className="text-sm text-brand-600 hover:underline">{t('manageCategories')}</Link>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addExpense')}</h2>
        <CreateExpenseForm categories={categoryOptions(categoryRows)} properties={propertyRows} today={today.toISOString().slice(0, 10)} />
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="month" className="text-sm font-medium text-slate-700">{t('monthLabel')}</label>
          <input id="month" type="month" name="month" defaultValue={month} className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="kind-filter" className="text-sm font-medium text-slate-700">{t('kindLabel')}</label>
          <select id="kind-filter" name="kind" defaultValue={kind ?? ''} className={fieldClass}>
            <option value="">{t('allKinds')}</option>
            {EXPENSE_KINDS.map((value) => <option key={value} value={value}>{t(`kind.${value}`)}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 rounded bg-slate-800 px-3 text-sm text-white">{t('filter')}</button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalTile label={t('kind.ordinary')} value={totals.ordinary} />
        <TotalTile label={t('kind.extraordinary')} value={totals.extraordinary} />
        <TotalTile label={t('total')} value={totals.ordinary + totals.extraordinary} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <Card padding="none" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">{t('dateLabel')}</th>
                <th className="px-4 py-2 font-medium">{t('descriptionLabel')}</th>
                <th className="px-4 py-2 font-medium">{t('categoryLabel')}</th>
                <th className="px-4 py-2 font-medium">{t('propertyLabel')}</th>
                <th className="px-4 py-2 font-medium">{t('kindLabel')}</th>
                <th className="px-4 py-2 font-medium text-right">{t('amountLabel')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const isExtraordinary = row.kind === 'extraordinary';
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{row.incurredOn}</td>
                    <td className="px-4 py-2">{row.description}</td>
                    <td className="px-4 py-2">{[row.parentCategoryName, row.categoryName].filter(Boolean).join(' › ') || '—'}</td>
                    <td className="px-4 py-2">{row.propertyName ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant={isExtraordinary ? 'warning' : 'default'}>
                        {t(isExtraordinary ? 'kind.extraordinary' : 'kind.ordinary')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{formatMoney(Number(row.amount))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
