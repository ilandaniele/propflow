import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { SettlementQuerySchema } from '@/lib/schemas/owner-settlement';
import { ownerSettlements, ownerTermsOverview } from '@/lib/finance/owner-settlement-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { OwnerTermsForm } from './OwnerTermsForm';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Owner settlements' };

const formatAmount = (currency: string, value: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value);

function shiftMonth(month: string, delta: number) {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export default async function OwnerSettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const parsed = SettlementQuerySchema.safeParse(await searchParams);
  const { month, owner_id: ownerId } = parsed.success ? parsed.data : SettlementQuerySchema.parse({});
  const [settlements, overview, t] = await Promise.all([
    ownerSettlements(ctx.orgId, { month, ownerId }),
    ownerTermsOverview(ctx.orgId),
    getTranslations('ownerSettlements'),
  ]);

  const query = (nextMonth: string) => `?month=${nextMonth}${ownerId ? `&owner_id=${encodeURIComponent(ownerId)}` : ''}`;
  const exportHref = `/api/admin/reports/owner-settlement${query(month)}`;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle', { month })}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton label={t('print')} />
          <a href={exportHref} className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
            {t('exportCsv')}
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <nav aria-label={t('monthNav')} className="flex items-center gap-3 text-sm">
          <Link href={query(shiftMonth(month, -1))} className="text-slate-600 underline">{shiftMonth(month, -1)}</Link>
          <span className="font-semibold text-slate-900 tabular-nums">{month}</span>
          <Link href={query(shiftMonth(month, 1))} className="text-slate-600 underline">{shiftMonth(month, 1)}</Link>
        </nav>
        <form method="get" className="flex items-center gap-2 text-sm">
          <input type="hidden" name="month" value={month} />
          <label htmlFor="settlement-owner" className="text-slate-600">{t('owner')}</label>
          <select id="settlement-owner" name="owner_id" defaultValue={ownerId ?? ''} className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">{t('allOwners')}</option>
            {overview.ownerOptions.map((option) => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">{t('apply')}</button>
        </form>
      </div>

      {settlements.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        settlements.map((settlement) => (
          <Card key={settlement.ownerId}>
            <h2 className="text-lg font-semibold text-slate-900">{settlement.ownerName ?? t('unnamedOwner')}</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">{t('property')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('income')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('expenses')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('commission')}</th>
                    <th className="py-2 font-medium text-right">{t('netToOwner')}</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.lines.map((line) => (
                    <tr key={`${line.propertyId}-${line.currency}`} className="border-b border-slate-100">
                      <td className="py-2 pr-4 text-slate-900">{line.propertyName}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(line.currency, line.income)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(line.currency, line.expenses)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(line.currency, line.commission)} <span className="text-slate-400">({line.commissionPct}%)</span></td>
                      <td className={`py-2 text-right tabular-nums font-medium ${line.net < 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatAmount(line.currency, line.net)}</td>
                    </tr>
                  ))}
                  {Object.entries(settlement.totals).map(([currency, total]) => (
                    <tr key={currency} className="font-semibold">
                      <td className="py-2 pr-4">{t('total', { currency })}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(currency, total.income)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(currency, total.expenses)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(currency, total.commission)}</td>
                      <td className={`py-2 text-right tabular-nums ${total.net < 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatAmount(currency, total.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Card className="print:hidden">
        <h2 className="text-lg font-semibold text-slate-900">{t('termsTitle')}</h2>
        <p className="text-sm text-slate-500 mb-4">{t('termsDesc')}</p>
        {overview.ownerOptions.length === 0 || overview.propertyOptions.length === 0 ? (
          <p className="text-sm text-slate-500">{t('termsMissingData')}</p>
        ) : (
          <OwnerTermsForm properties={overview.propertyOptions} owners={overview.ownerOptions} />
        )}
        {overview.terms.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {overview.terms.map((term) => (
              <li key={term.propertyId} className="flex justify-between py-2">
                <span className="text-slate-900">{term.propertyName}</span>
                <span className="text-slate-600">{term.ownerName ?? t('unnamedOwner')} · {Number(term.commissionPct)}%</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-slate-500">{t('expensesNote')}</p>
    </div>
  );
}
