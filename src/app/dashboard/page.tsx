import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import {
  computeOccupancyRate,
  computeOccupancy,
  computePastDueBalance,
  computeTrueNetProfit,
} from '@/lib/finance/kpis';
import { EmptyState } from '@/components/ui/EmptyState';
import Link from 'next/link';
import { entityLabel } from '@/lib/dashboard/health';
import { getDashboardKpis } from '@/lib/dashboard/queries';
import { ExpiringDocumentsBanner } from '@/components/document-expirations/ExpiringDocumentsBanner';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('adminDashboard');

  const kpis = await getDashboardKpis(ctx.orgId);

  // Entity health — derived from counts
  type EntityName = 'tenants' | 'properties' | 'payments' | 'contracts';
  const entityHealthMap: Record<EntityName, number> = kpis.entityCounts;
  // Only flag a "data not loading" anomaly when SOME entities have data but others
  // are empty — a partial/failed load. A brand-new org where everything is 0 is
  // simply empty (handled by the friendly empty state below), not an error, so we
  // must not show the scary DATABASE_URL/connection diagnostic to new users.
  const anyEntityHasData = Object.values(entityHealthMap).some((count) => count > 0);
  const unhealthyEntities = anyEntityHasData
    ? (Object.entries(entityHealthMap) as Array<[EntityName, number]>)
        .filter(([, count]) => count === 0)
        .map(([entity]) => ({ entity, count: 0, error: null }))
    : [];

  // Operational KPIs
  const { totalUnits, occupiedUnits, rentCollected, overdueCount, avgFeedback, pendingStatements } = kpis;
  const occupancyRate = computeOccupancyRate(occupiedUnits, totalUnits);

  // Financial KPIs
  const pastDueKpi = computePastDueBalance([kpis.pastDue]);
  const netProfitKpi = computeTrueNetProfit(kpis.mtdIncome, kpis.mtdExpenses);
  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  const totalAdditionalCharges = kpis.additionalChargesTotal;
  const contractTypeData = kpis.contractTypes;
  const contractTypeTotal = contractTypeData.reduce((s, r) => s + r.count, 0);
  const trashComplianceStats = kpis.trashCompliance;

  const hasData = totalUnits > 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* Diagnostic banner */}
      {unhealthyEntities.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">⚠ {t('diagnosticTitle')}</p>
          <p className="mb-1">
            {t('diagnosticCheck')}{' '}
            {unhealthyEntities.map((e) => entityLabel(e.entity as never)).join(', ')}.
          </p>
          <p className="text-amber-800">{t('diagnosticCause')}</p>
        </div>
      )}

      <ExpiringDocumentsBanner orgId={ctx.orgId} />

      {!hasData ? (
        <Card>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            }
            title={t('emptyTitle')}
            description={t('emptyDesc')}
            action={{ label: t('emptyAction'), href: '/dashboard/properties' }}
          />
        </Card>
      ) : (
        <>
          {/* Row 1 — Operational KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title={t('kpis.occupancy')} value={`${occupancyRate}%`} sub={t('kpis.occupancySub', { occupied: occupiedUnits, total: totalUnits })} color="text-green-600"
              icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>}
            />
            <KpiCard title={t('kpis.rentCollected')} value={`S/ ${rentCollected.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`} sub={t('kpis.rentCollectedSub')} color="text-brand-600"
              icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>}
            />
            <KpiCard title={t('kpis.openIncidents')} value={String(kpis.openIncidents)} sub={t('kpis.openIncidentsSub')} color={kpis.openIncidents > 0 ? 'text-amber-600' : 'text-slate-600'}
              icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/></svg>}
            />
            <KpiCard title={t('kpis.overdueTenants')} value={String(overdueCount)} sub={t('kpis.overdueTenantsSubSingle')} color={overdueCount > 0 ? 'text-red-600' : 'text-slate-600'}
              icon={<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>}
            />
          </div>

          {/* Row 2 — Financial KPIs */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('kpis.financialTitle')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <FinKpiCard title={t('kpis.trueNetProfit')} value={netProfitKpi.formatted} rawValue={netProfitKpi.value} sub={t('kpis.trueNetProfitSub')} positiveIsGood />
              <FinKpiCard title={t('kpis.pastDueBalance')} value={pastDueKpi.formatted} rawValue={pastDueKpi.value} sub={t('kpis.pastDueBalanceSub')} positiveIsGood={false} />
              <FinKpiCard title={t('kpis.occupancyFinancial')} value={occupancyKpi.formatted} rawValue={occupancyKpi.value} sub={t('kpis.occupancyFinancialSub', { occupied: occupiedUnits, total: totalUnits })} positiveIsGood />
            </div>
          </div>

          {/* Row 4 — Contract Analytics */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Contratos por tipo</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Tipo de contrato (activos)</p>
                <div className="space-y-2">
                  {contractTypeData.map(({ contractType, count }) => {
                    const pct = contractTypeTotal > 0 ? Math.round((count / contractTypeTotal) * 100) : 0;
                    const colors: Record<string, string> = {
                      'Nuevo ingreso': 'bg-green-500',
                      'Renovación': 'bg-blue-500',
                      'Traslado': 'bg-amber-500',
                      'Reingreso': 'bg-purple-500',
                    };
                    const color = colors[contractType] ?? 'bg-slate-400';
                    return (
                      <div key={contractType} className="flex items-center gap-3">
                        <span className="text-xs text-slate-600 w-28 shrink-0">{contractType}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-700 w-8 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </article>
              <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Cumplimiento basura (este mes)</p>
                <div className="space-y-2">
                  {trashComplianceStats.map(({ estado, count }) => {
                    const total = trashComplianceStats.reduce((s, r) => s + r.count, 0);
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    const colors: Record<string, string> = {
                      'Cumplido': 'bg-green-500',
                      'Incumplido': 'bg-red-500',
                      'Pendiente': 'bg-amber-400',
                    };
                    const color = colors[estado] ?? 'bg-slate-400';
                    return (
                      <div key={estado} className="flex items-center gap-3">
                        <span className="text-xs text-slate-600 w-28 shrink-0">{estado ?? '—'}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-slate-700 w-8 text-right">{count}</span>
                      </div>
                    );
                  })}
                  {trashComplianceStats.length === 0 && <p className="text-xs text-slate-400">Sin datos este mes</p>}
                </div>
              </article>
            </div>
          </div>

          {/* Row 3 — Billing KPIs */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('kpis.additionalChargesTitle')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpis.totalAdditionalCharges')}</p>
                <p className="text-2xl font-bold text-slate-900">S/ {totalAdditionalCharges.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-slate-400 mt-1">{t('kpis.totalAdditionalChargesSub')}</p>
              </article>
              <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpis.pendingStatements')}</p>
                <p className={`text-2xl font-bold ${pendingStatements > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{pendingStatements}</p>
                <p className="text-xs text-slate-400 mt-1">{t('kpis.pendingStatementsSub')}</p>
              </article>
              <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpis.avgFeedback')}</p>
                <p className="text-2xl font-bold text-slate-900">{avgFeedback !== null ? `${avgFeedback.toFixed(1)} / 5` : '—'}</p>
                <p className="text-xs text-slate-400 mt-1">{t('kpis.avgFeedbackSub')}</p>
              </article>
            </div>
          </div>
        </>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <QuickAction href="/dashboard/tenants" label={t('quickActions.tenants')} description={t('quickActions.tenantsSub')} />
        <QuickAction href="/dashboard/payments" label={t('quickActions.payments')} description={t('quickActions.paymentsSub')} />
        <QuickAction href="/dashboard/incidents" label={t('quickActions.incidents')} description={t('quickActions.incidentsSub')} />
        <QuickAction href="/dashboard/account-statements" label={t('quickActions.statements')} description={t('quickActions.statementsSub')} />
        <QuickAction href="/dashboard/tenant-feedback" label={t('quickActions.feedback')} description={t('quickActions.feedbackSub')} />
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, color, icon }: {
  title: string; value: string; sub: string; color: string; icon: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg bg-slate-50 ${color}`}>{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${color} mb-0.5`}>{value}</p>
      <p className="text-xs font-medium text-slate-700 mb-0.5">{title}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </Card>
  );
}

function FinKpiCard({ title, value, rawValue, sub, positiveIsGood }: {
  title: string; value: string; rawValue: number; sub: string; positiveIsGood: boolean;
}) {
  const valueColor =
    rawValue > 0 && positiveIsGood ? 'text-green-700'
    : rawValue < 0 || (!positiveIsGood && rawValue > 0) ? 'text-red-600'
    : 'text-slate-700';
  return (
    <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</p>
      <p className={`text-2xl font-bold mb-1 ${valueColor}`}>{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </article>
  );
}

function QuickAction({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <Link href={href} className="group block bg-white rounded-xl border border-slate-200 p-5 hover:border-brand-300 hover:shadow-md transition-all duration-150">
      <p className="font-semibold text-slate-900 text-sm mb-1 group-hover:text-brand-700 transition-colors">{label}</p>
      <p className="text-xs text-slate-500">{description}</p>
    </Link>
  );
}
