import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { formatAmount } from '@/lib/finance/month';
import type { OwnerSettlement } from '@/lib/finance/owner-settlement';

export async function OwnerSettlementCard({ settlement }: { settlement: OwnerSettlement }) {
  const t = await getTranslations('ownerSettlements');
  return (
    <Card>
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
  );
}
