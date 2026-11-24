import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { buildRentalTaxReport } from '@/lib/finance/rental-tax';
import { rentalIncomeByMonth } from '@/lib/finance/rental-tax-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Rental income tax' };

const MONTHS = Array.from({ length: 12 }, (_, index) => index);
const money = (value: number) => (value === 0 ? '—' : value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function parseYear(raw: string | undefined, fallback: number) {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallback;
}

export default async function RentalTaxPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('rentalTax');
  const year = parseYear((await searchParams).year, new Date().getFullYear());
  const { lines, totals } = buildRentalTaxReport(await rentalIncomeByMonth(ctx.orgId, year));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title', { year })}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{t('subtitle')}</p>
        </div>
        <nav aria-label={t('yearNav')} className="flex gap-3 text-sm font-medium text-slate-700">
          <Link href={`?year=${year - 1}`} className="hover:underline">← {year - 1}</Link>
          <Link href={`?year=${year + 1}`} className="hover:underline">{year + 1} →</Link>
        </nav>
      </div>

      {lines.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map((total) => (
              <Card key={total.currency}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('grossLabel', { currency: total.currency })}</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{money(total.total)}</p>
                <p className="text-sm text-slate-600 mt-1 tabular-nums">{t('taxLabel')}: {money(total.tax)}</p>
              </Card>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs" aria-label={t('title', { year })}>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2">{t('colProperty')}</th>
                  {MONTHS.map((month) => <th key={month} className="text-right px-2 py-2">{t(`months.${month}`)}</th>)}
                  <th className="text-right px-3 py-2">{t('colTotal')}</th>
                  <th className="text-right px-3 py-2">{t('colTax')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr key={`${line.propertyId}-${line.currency}`}>
                    <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{line.propertyName} <span className="text-slate-400">{line.currency}</span></td>
                    {line.months.map((value, month) => <td key={month} className="px-2 py-2 text-right tabular-nums text-slate-600">{money(value)}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{money(line.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(line.tax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                {totals.map((total) => (
                  <tr key={total.currency}>
                    <th scope="row" className="px-3 py-2 text-left text-slate-700">{t('monthlyTax', { currency: total.currency })}</th>
                    {total.monthTax.map((value, month) => <td key={month} className="px-2 py-2 text-right tabular-nums font-semibold text-slate-900">{money(value)}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(total.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">{money(total.tax)}</td>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-slate-500">{t('disclaimer')}</p>
        </>
      )}
    </div>
  );
}
