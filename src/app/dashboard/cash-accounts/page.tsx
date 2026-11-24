import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listCashAccounts, monthlyTotalsByAccount } from '@/lib/finance/cash-accounts';
import { currentBalance, liquidate, monthParam } from '@/lib/finance/cash-ledger-math';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CashAccountForm } from './CashAccountForm';
import { MonthNav } from './MonthNav';

export const metadata: Metadata = { title: 'Cash and bank accounts' };

const exportClasses = 'inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

export default async function CashAccountsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('cashAccounts');
  const month = monthParam((await searchParams).month, new Date().toISOString().slice(0, 7));

  const [accounts, totals] = await Promise.all([listCashAccounts(ctx.orgId), monthlyTotalsByAccount(ctx.orgId)]);
  const rows = accounts.map((account) => {
    const accountTotals = totals.get(account.id) ?? [];
    const [summary] = liquidate(Number(account.openingBalance), accountTotals, [month]);
    return { ...account, summary, balance: currentBalance(Number(account.openingBalance), accountTotals) };
  });
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav basePath="/dashboard/cash-accounts" month={month} previousLabel={t('previous')} nextLabel={t('next')} />
          <a href={`/api/admin/cash-accounts/export?year=${month.slice(0, 4)}`} className={exportClasses} download>
            {t('exportAnnual', { year: month.slice(0, 4) })}
          </a>
        </div>
      </div>

      <CashAccountForm />

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-700">{t('monthlyTitle', { month })}</h2>
          <table className="w-full text-sm mt-2" aria-label={t('monthlyTitle', { month })}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colAccount')}</th>
                <th className="text-right px-4 py-3">{t('colOpening')}</th>
                <th className="text-right px-4 py-3">{t('colIncome')}</th>
                <th className="text-right px-4 py-3">{t('colOutflow')}</th>
                <th className="text-right px-4 py-3">{t('colClosing')}</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">{t('colBalance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className={row.active ? undefined : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/cash-accounts/${row.id}?month=${month}`} className="font-medium text-slate-900 hover:underline">
                      {row.name}
                    </Link>
                    <span className="block text-xs text-slate-400">
                      {row.kind === 'bank' ? [row.bankName, row.accountNumber].filter(Boolean).join(' · ') || t('kindBank') : t('kindCash')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.summary.opening)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-green-700">{formatMoney(row.summary.income)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatMoney(row.summary.outflow)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatMoney(row.summary.closing)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500 hidden md:table-cell">{formatMoney(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-3">{t('total')}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.summary.opening))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.summary.income))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.summary.outflow))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(sum((r) => r.summary.closing))}</td>
                <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">{formatMoney(sum((r) => r.balance))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
