import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { payments as paymentsTable, contracts, tenants } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { computePaymentKpis } from '@/lib/finance/payment-kpis';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { ApprovePaymentButton } from './ApprovePaymentButton';
import { CreateChargeForm } from './CreateChargeForm';
import { AdminPaymentsCsvButtons } from './AdminPaymentsCsvButtons';

export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('payments');

  const [statRows, paymentRows, contractRows] = await Promise.all([
    // ALL payments (aggregation columns only) — KPI totals must cover every row,
    // not just the 200 shown in the table, or collected/pending/rate are wrong.
    db
      .select({
        amount:    paymentsTable.amount,
        paidAt:    paymentsTable.paidAt,
        method:    paymentsTable.method,
        status:    paymentsTable.status,
        createdAt: paymentsTable.createdAt,
      })
      .from(paymentsTable)
      .where(eq(paymentsTable.orgId, ctx.orgId)),
    db
      .select({
        id:         paymentsTable.id,
        amount:     paymentsTable.amount,
        paidAt:     paymentsTable.paidAt,
        method:     paymentsTable.method,
        status:     paymentsTable.status,
        createdAt:  paymentsTable.createdAt,
        tenantName: tenants.fullName,
      })
      .from(paymentsTable)
      .leftJoin(tenants, and(eq(tenants.id, paymentsTable.tenantId), eq(tenants.orgId, ctx.orgId)))
      .where(eq(paymentsTable.orgId, ctx.orgId))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(200),
    db
      .select({
        id:          contracts.id,
        monthlyRent: contracts.monthlyRent,
        tenantId:    contracts.tenantId,
        tenantName:  tenants.fullName,
      })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'))),
  ]);

  // Analytics — computed over ALL payments (statRows), never the capped table set.
  const { pendingCount, collectedTotal, pendingTotal, collectionRate, byMethod, byMonth } =
    computePaymentKpis(statRows);
  const topMethods = Object.entries(byMethod).sort(([, a], [, b]) => b - a).slice(0, 4);

  // Monthly collected trend (last 6 months)
  const now = new Date();
  const last6months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const maxMonthAmount = Math.max(1, ...last6months.map((k) => byMonth[k] ?? 0));

  // Shape for CreateChargeForm
  const contractsForForm = contractRows.map((c) => ({
    id: c.id,
    monthly_rent: Number(c.monthlyRent),
    tenant_id: c.tenantId,
    tenants: c.tenantName ? { full_name: c.tenantName } : null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-600 font-medium mt-1">
              {t('list.pendingApproval', { count: pendingCount })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AdminPaymentsCsvButtons />
          <CreateChargeForm contracts={contractsForForm as unknown as Array<{ id: string; monthly_rent: number; tenant_id: string; tenants: { full_name: string } | null }>} />
        </div>
      </div>

      {/* Analytics KPIs */}
      {statRows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.collected')}</p>
            <p className="text-xl font-bold text-slate-900">S/ {collectedTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.pending')}</p>
            <p className="text-xl font-bold text-amber-600">S/ {pendingTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.collectionRate')}</p>
            <p className="text-xl font-bold text-slate-900">{collectionRate}%</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.byMethod')}</p>
            <div className="mt-1 space-y-0.5">
              {topMethods.map(([method, count]) => (
                <div key={method} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 capitalize">{method}</span>
                  <span className="font-semibold text-slate-700">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Monthly collected trend */}
      {last6months.some((k) => byMonth[k] > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.monthlyTrend')}</h2>
          <div className="flex items-end gap-1 h-24">
            {last6months.map((k) => {
              const amount = byMonth[k] ?? 0;
              const heightPct = Math.round((amount / maxMonthAmount) * 100);
              return (
                <div key={k} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '64px' }}>
                    <div
                      title={`${k}: S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
                      style={{ height: `${heightPct}%`, minHeight: amount > 0 ? '4px' : '0' }}
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

      {paymentRows.length === 0 ? (
        <Card>
          <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colAmount')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('list.colDate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colMethod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colStatus')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paymentRows.map((payment) => (
                <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium text-slate-900">{payment.tenantName ?? '—'}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                    S/ {Number(payment.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{payment.paidAt}</td>
                  <td className="px-5 py-4 text-sm text-slate-500 capitalize hidden md:table-cell">{payment.method}</td>
                  <td className="px-5 py-4"><StatusPill status={payment.status} /></td>
                  <td className="px-5 py-4 text-right">
                    {payment.status === 'pending' && (
                      <ApprovePaymentButton paymentId={payment.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
