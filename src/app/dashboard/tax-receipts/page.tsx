import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { taxReceipts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { computeTaxReceiptKpis } from '@/lib/finance/tax-receipt-kpis';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Tax Receipts' };

function statusClass(status: string | null): string {
  switch (status) {
    case 'issued':    return 'bg-green-100 text-green-700';
    case 'cancelled': return 'bg-red-100 text-red-700';
    case 'draft':     return 'bg-slate-100 text-slate-600';
    default:          return 'bg-amber-100 text-amber-700';
  }
}

export default async function TaxReceiptsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('taxReceipts');

  const rows = await db
    .select()
    .from(taxReceipts)
    .where(eq(taxReceipts.orgId, ctx.orgId))
    .orderBy(desc(taxReceipts.anio), desc(taxReceipts.mes));
  // No .limit(): KPI totals (amount/base/IGV, by-type, by-month) cover all rows.
  // The table is sliced to 200 below for DOM size.

  // Analytics — over ALL receipts (rows is uncapped; table render is sliced).
  const {
    issuedCount, cancelledCount, draftCount,
    totalAmount, totalBase, totalIGV, byType, byMonth,
  } = computeTaxReceiptKpis(rows);
  const monthKeys = Object.keys(byMonth).sort().slice(-6);
  const maxMonth = Math.max(1, ...monthKeys.map((k) => byMonth[k]));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('subtitle', { count: rows.length, total: totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 }) })}
        </p>
      </div>

      {rows.length > 0 && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.issuedTotal')}</p>
              <p className="text-xl font-bold text-slate-900">S/ {totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.igvTotal')}</p>
              <p className="text-xl font-bold text-slate-900">S/ {totalIGV.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('kpi.base')}: S/ {totalBase.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.issued')}</p>
              <p className="text-xl font-bold text-green-600">{issuedCount}</p>
              {cancelledCount > 0 && <p className="text-xs text-red-500 mt-0.5">{cancelledCount} {t('kpi.cancelled')}</p>}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.draft')}</p>
              <p className="text-xl font-bold text-slate-500">{draftCount}</p>
            </div>
          </div>

          {/* By type + monthly trend */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* By type */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.byType')}</h2>
              <div className="space-y-2">
                {Object.entries(byType).sort(([, a], [, b]) => b.total - a.total).map(([tipo, { count, total }]) => (
                  <div key={tipo} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 capitalize">{tipo}</span>
                      <span className="text-xs text-slate-400">×{count}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">S/ {total.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Monthly issued trend */}
            {monthKeys.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.monthlyTrend')}</h2>
                <div className="flex items-end gap-1 h-24">
                  {monthKeys.map((k) => {
                    const amount = byMonth[k];
                    const heightPct = Math.round((amount / maxMonth) * 100);
                    return (
                      <div key={k} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex items-end justify-center" style={{ height: '64px' }}>
                          <div
                            title={`${k}: S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
                            style={{ height: `${heightPct}%`, minHeight: '4px' }}
                            className="w-full rounded-t-sm bg-green-400"
                          />
                        </div>
                        <p className="text-xs text-slate-400">{k.slice(5)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colCode')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colType')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colPeriod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTotal')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colIGV')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colIssueDate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 200).map((receipt) => {
                const period = receipt.mes && receipt.anio ? `${receipt.mes} ${receipt.anio}` : '—';
                return (
                  <tr key={receipt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{receipt.receiptCode ?? receipt.numero ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell capitalize">{receipt.tipo ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {Number(receipt.totalAmount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {receipt.includesIgv ? `S/ ${Number(receipt.igvAmount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell">{receipt.issueDate ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(receipt.status)}`}>
                        {receipt.status ?? 'unknown'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
