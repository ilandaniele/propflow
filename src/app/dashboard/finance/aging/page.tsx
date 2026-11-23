import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { AGING_BUCKETS } from '@/lib/finance/aging';
import { loadAging } from '@/lib/finance/load-aging';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

const MAX_ROWS = 200;
const money = (n: number) => `S/ ${n.toFixed(2)}`;

export default async function AgingPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('finance');
  const bucketLabels = {
    '0_30': t('aging.bucket.0_30'),
    '31_60': t('aging.bucket.31_60'),
    '61_90': t('aging.bucket.61_90'),
    '90_plus': t('aging.bucket.90_plus'),
  };
  const rows = await loadAging(ctx.orgId, new Date().toISOString().slice(0, 10));
  const totals = AGING_BUCKETS.map((bucket) => rows.reduce((sum, row) => sum + row.buckets[bucket], 0));
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/dashboard/finance" className="text-xs text-slate-500 hover:text-brand-600 transition-colors mb-1 block">
          ← {t('backToFinance')}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">{t('aging.title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('aging.subtitle')}</p>
      </div>

      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('aging.cardTitle')}</CardTitle>
        </CardHeader>
        {rows.length === 0 ? (
          <EmptyState title={t('aging.emptyTitle')} description={t('aging.emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 font-medium text-slate-600">{t('aging.tenant')}</th>
                  {AGING_BUCKETS.map((bucket) => (
                    <th key={bucket} className="text-right py-2 font-medium text-slate-600">{bucketLabels[bucket]}</th>
                  ))}
                  <th className="text-right py-2 font-medium text-slate-600">{t('aging.total')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map((row) => (
                  <tr key={row.tenantId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2">
                      <Link href={`/dashboard/tenants/${row.tenantId}`} className="text-slate-700 hover:text-brand-600">{row.tenantName}</Link>
                    </td>
                    {AGING_BUCKETS.map((bucket) => (
                      <td key={bucket} className="py-2 text-right tabular-nums text-slate-700">{money(row.buckets[bucket])}</td>
                    ))}
                    <td className="py-2 text-right tabular-nums font-medium text-red-600">{money(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-medium">
                  <td className="py-2 text-slate-900">{t('aging.total')}</td>
                  {totals.map((value, index) => (
                    <td key={AGING_BUCKETS[index]} className="py-2 text-right tabular-nums text-slate-900">{money(value)}</td>
                  ))}
                  <td className="py-2 text-right tabular-nums text-red-600">{money(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
