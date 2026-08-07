import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { additionalCharges, contracts, tenants } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { computeChargeKpis } from '@/lib/finance/charge-kpis';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Additional Charges' };

export default async function AdditionalChargesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('additionalCharges');

  const rows = await db
    .select({
      id:          additionalCharges.id,
      contractId:  additionalCharges.contractId,
      mes:         additionalCharges.mes,
      anio:        additionalCharges.anio,
      amount:      additionalCharges.amount,
      description: additionalCharges.description,
      numero:      additionalCharges.numero,
      tenantFullName: tenants.fullName,
    })
    .from(additionalCharges)
    .leftJoin(contracts, and(eq(contracts.id, additionalCharges.contractId), eq(contracts.orgId, ctx.orgId)))
    .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
    .where(eq(additionalCharges.orgId, ctx.orgId))
    .orderBy(desc(additionalCharges.anio), desc(additionalCharges.mes));
  // No .limit() here: the KPI totals below (total, by-concept, by-month, by-tenant)
  // must cover every charge. The table render is sliced to 200 for DOM size.

  const { totalAmount, byDescription, byMonth, byTenant } = computeChargeKpis(rows, {
    noDescription: t('kpi.noDescription'),
    unknownTenant: t('kpi.unknown'),
  });
  const topConcepts = Object.entries(byDescription).sort(([, a], [, b]) => b - a).slice(0, 6);
  const monthKeys = Object.keys(byMonth).sort().slice(-6);
  const maxMonthAmount = Math.max(1, ...monthKeys.map((k) => byMonth[k]));
  const topTenants = Object.values(byTenant).sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('subtitle', { count: rows.length, total: totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 }) })}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* By concept */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.byConcept')}</h2>
            <div className="space-y-2">
              {topConcepts.map(([desc, amount]) => {
                const pct = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
                return (
                  <div key={desc}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-600 truncate max-w-[120px]">{desc}</span>
                      <span className="font-semibold text-slate-700">S/ {amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="bg-slate-100 rounded-full h-1.5">
                      <div className="bg-brand-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By month bar chart */}
          {monthKeys.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.byMonth')}</h2>
              <div className="flex items-end gap-1 h-24">
                {monthKeys.map((k) => {
                  const amount = byMonth[k];
                  const heightPct = Math.round((amount / maxMonthAmount) * 100);
                  return (
                    <div key={k} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center" style={{ height: '64px' }}>
                        <div
                          title={`${k}: S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
                          style={{ height: `${heightPct}%`, minHeight: '4px' }}
                          className="w-full rounded-t-sm bg-brand-400"
                        />
                      </div>
                      <p className="text-xs text-slate-400">{k.slice(5)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By tenant */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.byTenant')}</h2>
            <div className="space-y-2">
              {topTenants.map(({ name, total }) => (
                <div key={name} className="flex justify-between items-center">
                  <span className="text-xs text-slate-600 truncate max-w-[120px]">{name}</span>
                  <span className="text-xs font-semibold text-slate-700">S/ {total.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colPeriod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colAmount')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colDescription')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colNumber')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 200).map((charge) => {
                const period = charge.mes && charge.anio ? `${charge.mes} ${charge.anio}` : '—';
                return (
                  <tr key={charge.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{charge.tenantFullName ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {Number(charge.amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell max-w-xs truncate">
                      {charge.description ?? '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-400 hidden lg:table-cell">{charge.numero ?? '—'}</td>
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
