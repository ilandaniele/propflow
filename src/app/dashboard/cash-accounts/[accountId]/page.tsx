import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { cashAccounts } from '@/lib/db/schema';
import { listMonthMovements, monthlyTotalsByAccount } from '@/lib/finance/cash-accounts';
import { liquidate, monthParam, withRunningBalance } from '@/lib/finance/cash-ledger-math';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CashMovementForm } from './CashMovementForm';
import { MonthNav } from '../MonthNav';

export const metadata: Metadata = { title: 'Account movements' };

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CashAccountPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const { accountId } = await params;
  if (!GUID_RE.test(accountId)) notFound();
  const t = await getTranslations('cashAccounts');
  const month = monthParam((await searchParams).month, new Date().toISOString().slice(0, 7));

  const [[account], totals, movements] = await Promise.all([
    db
      .select({ name: cashAccounts.name, openingBalance: cashAccounts.openingBalance, active: cashAccounts.active })
      .from(cashAccounts)
      .where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.orgId, ctx.orgId)))
      .limit(1),
    monthlyTotalsByAccount(ctx.orgId, accountId),
    listMonthMovements(ctx.orgId, accountId, month),
  ]);
  if (!account) notFound();

  const [summary] = liquidate(Number(account.openingBalance), totals.get(accountId) ?? [], [month]);
  const rows = withRunningBalance(summary.opening, movements);
  const cards = [
    { label: t('colOpening'), value: summary.opening, tone: 'text-slate-900' },
    { label: t('colIncome'), value: summary.income, tone: 'text-green-700' },
    { label: t('colOutflow'), value: summary.outflow, tone: 'text-red-600' },
    { label: t('colClosing'), value: summary.closing, tone: 'text-slate-900' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href={`/dashboard/cash-accounts?month=${month}`} className="text-sm text-slate-500 hover:underline">{t('back')}</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{account.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav basePath={`/dashboard/cash-accounts/${accountId}`} month={month} previousLabel={t('previous')} nextLabel={t('next')} />
          <a
            href={`/api/admin/cash-accounts/export?account=${accountId}&month=${month}`}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            download
          >
            {t('exportMonth')}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{card.label}</p>
            <p className={`text-xl font-bold tabular-nums ${card.tone}`}>{formatMoney(card.value)}</p>
          </div>
        ))}
      </div>

      {account.active && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('movement.title')}</h2>
          <CashMovementForm accountId={accountId} defaultDate={`${month}-01`} />
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><EmptyState title={t('movement.emptyTitle')} description={t('movement.emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={account.name}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colDate')}</th>
                <th className="text-left px-4 py-3">{t('colConcept')}</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">{t('colDocument')}</th>
                <th className="text-right px-4 py-3">{t('colIncome')}</th>
                <th className="text-right px-4 py-3">{t('colOutflow')}</th>
                <th className="text-right px-4 py-3">{t('colBalance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 text-slate-500 tabular-nums">{row.occurredOn}</td>
                  <td className="px-4 py-2">{row.concept}</td>
                  <td className="px-4 py-2 text-slate-500 hidden md:table-cell">{row.document ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-700">{row.direction === 'in' ? formatMoney(Number(row.amount)) : ''}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600">{row.direction === 'out' ? formatMoney(Number(row.amount)) : ''}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{formatMoney(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
