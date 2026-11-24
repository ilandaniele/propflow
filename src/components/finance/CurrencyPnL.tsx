import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney } from '@/lib/finance/currency';
import type { PnLReport } from '@/lib/finance/reports';

export async function CurrencyPnL({ currency, pnl }: { currency: string; pnl: PnLReport }) {
  const t = await getTranslations('finance');
  const money = (n: number) => formatMoney(currency, n);

  return (
    <section className="space-y-4" data-testid={`pnl-${currency}`}>
      <h2 className="text-lg font-semibold text-slate-900">{t('currencySection', { currency })}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalIncome')}</p>
          <p className="mt-1 text-2xl font-bold text-green-600">{money(pnl.totalIncome)}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalExpenses')}</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{money(pnl.totalExpenses)}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('netIncome')}</p>
          <p className={`mt-1 text-2xl font-bold ${pnl.netIncome >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{money(pnl.netIncome)}</p>
        </Card>
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>{t('pnlByMonth')}</CardTitle></CardHeader>
        {pnl.byMonth.length === 0 ? (
          <EmptyState title={t('noData')} description={t('noDataDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 font-medium text-slate-600">{t('month')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('income')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('expenses')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('net')}</th>
                </tr>
              </thead>
              <tbody>
                {pnl.byMonth.map((row) => (
                  <tr key={row.month} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-700">{row.month}</td>
                    <td className="py-2 text-right text-green-600">{money(row.income)}</td>
                    <td className="py-2 text-right text-red-500">{money(row.expenses)}</td>
                    <td className={`py-2 text-right font-medium ${row.net >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{money(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
