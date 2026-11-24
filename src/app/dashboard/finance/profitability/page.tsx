import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { ProfitabilityQuerySchema } from '@/lib/schemas/profitability';
import { profitabilityReport, propertyOptions } from '@/lib/finance/profitability-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Profitability' };

const formatAmount = (currency: string, value: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value);

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const parsed = ProfitabilityQuerySchema.safeParse(await searchParams);
  const { year, property_id: propertyId } = parsed.success ? parsed.data : ProfitabilityQuerySchema.parse({});
  const [report, options, t] = await Promise.all([
    profitabilityReport(ctx.orgId, { year, propertyId }),
    propertyOptions(ctx.orgId),
    getTranslations('profitability'),
  ]);

  const query = (nextYear: number) => `?year=${nextYear}${propertyId ? `&property_id=${encodeURIComponent(propertyId)}` : ''}`;
  const exportHref = `/api/admin/reports/profitability${query(year)}`;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <a href={exportHref} className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {t('exportCsv')}
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <nav aria-label={t('yearNav')} className="flex items-center gap-3 text-sm">
          <Link href={query(year - 1)} className="text-slate-600 underline">{year - 1}</Link>
          <span className="font-semibold text-slate-900 tabular-nums">{year}</span>
          <Link href={query(year + 1)} className="text-slate-600 underline">{year + 1}</Link>
        </nav>
        <form method="get" className="flex items-center gap-2 text-sm">
          <input type="hidden" name="year" value={year} />
          <label htmlFor="profitability-property" className="text-slate-600">{t('property')}</label>
          <select id="profitability-property" name="property_id" defaultValue={propertyId ?? ''} className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">{t('allProperties')}</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">{t('apply')}</button>
        </form>
      </div>

      {report.lines.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(report.totals).map(([currency, total]) => (
              <Card key={currency}>
                <p className="text-xs font-medium uppercase text-slate-500">{t('netIn', { currency })}</p>
                <p className={`text-2xl font-bold tabular-nums ${total.net < 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatAmount(currency, total.net)}</p>
                <p className="text-sm text-slate-500 tabular-nums">{t('incomeVsExpenses', { income: formatAmount(currency, total.income), expenses: formatAmount(currency, total.expenses) })}</p>
              </Card>
            ))}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">{t('property')}</th>
                    <th className="py-2 pr-4 font-medium">{t('currency')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('income')}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t('expenses')}</th>
                    <th className="py-2 font-medium text-right">{t('net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines.map((line) => (
                    <tr key={`${line.propertyId ?? 'none'}-${line.currency}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-slate-900">{line.propertyName ?? t('noProperty')}</td>
                      <td className="py-2 pr-4 text-slate-600">{line.currency}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(line.currency, line.income)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatAmount(line.currency, line.expenses)}</td>
                      <td className={`py-2 text-right tabular-nums font-medium ${line.net < 0 ? 'text-red-600' : 'text-slate-900'}`}>{formatAmount(line.currency, line.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-slate-500">{t('expensesNote')}</p>
        </>
      )}
    </div>
  );
}
