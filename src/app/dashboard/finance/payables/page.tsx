import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { expenseCategories, properties } from '@/lib/db/schema';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PayableFiltersSchema } from '@/lib/schemas/payables';
import { listPayables, payablesSummary, PAYABLES_PAGE_SIZE } from '@/lib/finance/payables/queries';
import { PAYABLE_STATUSES, type PayableStatus } from '@/lib/finance/payables/status';
import { formatSolesCents } from '@/lib/finance/payables/format';
import { CreatePayableForm } from './CreatePayableForm';
import { RegisterPaymentForm } from './RegisterPaymentForm';

export const metadata: Metadata = { title: 'Cuentas por pagar' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<PayableStatus, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'default',
  partial: 'info',
  paid: 'success',
  overdue: 'danger',
};

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const filters = PayableFiltersSchema.parse(await searchParams);
  const t = await getTranslations('payables');
  const today = new Date().toISOString().slice(0, 10);

  const [{ items, total }, summary, propertyOptions, categoryOptions] = await Promise.all([
    listPayables(ctx.orgId, filters, today),
    payablesSummary(ctx.orgId, today),
    db.select({ id: properties.id, name: properties.name }).from(properties)
      .where(eq(properties.orgId, ctx.orgId)).orderBy(asc(properties.name)),
    db.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories)
      .where(eq(expenseCategories.orgId, ctx.orgId)).orderBy(asc(expenseCategories.name)),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAYABLES_PAGE_SIZE));
  const qs = (page: number) => {
    const sp = new URLSearchParams({ page: String(page) });
    if (filters.status) sp.set('status', filters.status);
    if (filters.due_from) sp.set('due_from', filters.due_from);
    if (filters.due_to) sp.set('due_to', filters.due_to);
    return `?${sp.toString()}`;
  };

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <Link href="/dashboard/finance" className="text-sm text-brand-600 hover:underline">{t('back')}</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-slate-500">{t('totals.pending')}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900" data-testid="payables-total-pending">{formatSolesCents(summary.pendingCents)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">{t('totals.overdue')}</p>
          <p className="mt-1 text-2xl font-semibold text-red-600" data-testid="payables-total-overdue">{formatSolesCents(summary.overdueCents)}</p>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('form.title')}</CardTitle></CardHeader>
        <CreatePayableForm properties={propertyOptions} categories={categoryOptions} today={today} />
      </Card>

      <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="payables-status" className="text-xs font-medium text-slate-500">{t('filters.status')}</label>
          <select id="payables-status" name="status" defaultValue={filters.status ?? ''} className="border border-slate-300 rounded-md px-2 py-1 text-sm">
            <option value="">{t('filters.all')}</option>
            {PAYABLE_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payables-due-from" className="text-xs font-medium text-slate-500">{t('filters.dueFrom')}</label>
          <input id="payables-due-from" type="date" name="due_from" defaultValue={filters.due_from ?? ''} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payables-due-to" className="text-xs font-medium text-slate-500">{t('filters.dueTo')}</label>
          <input id="payables-due-to" type="date" name="due_to" defaultValue={filters.due_to ?? ''} className="border border-slate-300 rounded-md px-2 py-1 text-sm" />
        </div>
        <button type="submit" className="bg-indigo-600 text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-indigo-700 transition-colors">
          {t('filters.apply')}
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <EmptyState title={t('empty.title')} description={t('empty.description')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.issuedOn')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.supplier')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.description')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.documentRef')}</th>
                <th className="text-right py-2 px-4 font-medium text-slate-600">{t('columns.amount')}</th>
                <th className="text-right py-2 px-4 font-medium text-slate-600">{t('columns.saldo')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.dueOn')}</th>
                <th className="text-left py-2 px-4 font-medium text-slate-600">{t('columns.status')}</th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                  <td className="py-2 px-4 text-slate-700 whitespace-nowrap">{p.issuedOn}</td>
                  <td className="py-2 px-4 text-slate-900">
                    {p.supplierName}
                    {(p.propertyName || p.categoryName) && (
                      <div className="text-xs text-slate-400">{[p.propertyName, p.categoryName].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td className="py-2 px-4 text-slate-700">{p.description ?? '—'}</td>
                  <td className="py-2 px-4 text-slate-700">{p.documentRef ?? '—'}</td>
                  <td className="py-2 px-4 text-right text-slate-700 whitespace-nowrap">{formatSolesCents(p.amountCents)}</td>
                  <td className="py-2 px-4 text-right font-medium text-slate-900 whitespace-nowrap">{formatSolesCents(p.saldoCents)}</td>
                  <td className="py-2 px-4 text-slate-700 whitespace-nowrap">{p.dueOn}</td>
                  <td className="py-2 px-4"><Badge variant={STATUS_BADGE[p.status]}>{t(`status.${p.status}`)}</Badge></td>
                  <td className="py-2 px-4">
                    {p.saldoCents > 0 && <RegisterPaymentForm payableId={p.id} saldoCents={p.saldoCents} today={today} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">{filters.page} / {totalPages}</span>
          <div className="flex gap-2">
            {filters.page > 1 && <Link href={qs(filters.page - 1)} className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50">‹</Link>}
            {filters.page < totalPages && <Link href={qs(filters.page + 1)} className="px-3 py-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50">›</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
