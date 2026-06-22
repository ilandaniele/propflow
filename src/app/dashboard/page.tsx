import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import {
  units as unitsTable,
  payments as paymentsTable,
  incidents as incidentsTable,
  expenses as expensesTable,
  airtableSnapshots,
  additionalCharges,
  accountStatements,
  tenantFeedback,
  tenants,
  properties,
  contracts,
} from '@/lib/db/schema';
import { eq, and, gte, ne, desc, sql } from 'drizzle-orm';
import { Card } from '@/components/ui/Card';
import {
  computeOccupancyRate,
  computeRentCollectedThisMonth,
  computeOccupancy,
  computePastDueBalance,
  computeTrueNetProfit,
} from '@/lib/finance/kpis';
import { AirtableOccupancyDelta } from '@/components/portfolio/AirtableOccupancyDelta';
import { EmptyState } from '@/components/ui/EmptyState';
import Link from 'next/link';
import { entityLabel } from '@/lib/dashboard/health';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('adminDashboard');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [
    unitRows,
    paymentRows,
    incidentRows,
    statementResult,
    expenseRows,
    airtableRows,
    additionalChargeRows,
    accountStatementRows,
    feedbackRows,
    // Entity health checks — inlined (faster than calling checkEntityHealth per entity)
    tenantCount,
    propertyCount,
    paymentCount,
    contractCount,
  ] = await Promise.all([
    db.select({ id: unitsTable.id, status: unitsTable.status }).from(unitsTable).where(eq(unitsTable.orgId, ctx.orgId)),
    db.select({ amount: paymentsTable.amount, paidAt: paymentsTable.paidAt, status: paymentsTable.status })
      .from(paymentsTable).where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'approved'))),
    db.select({ id: incidentsTable.id, status: incidentsTable.status })
      .from(incidentsTable).where(and(eq(incidentsTable.orgId, ctx.orgId), ne(incidentsTable.status, 'solved'))),
    db.execute(sql`SELECT is_overdue, total_charged, total_paid, balance FROM tenant_statement WHERE org_id = ${ctx.orgId}`),
    db.select({ amount: expensesTable.amount, incurredOn: expensesTable.incurredOn })
      .from(expensesTable).where(and(eq(expensesTable.orgId, ctx.orgId), gte(expensesTable.incurredOn, startOfMonth))),
    db.select({ data: airtableSnapshots.data, syncedAt: airtableSnapshots.syncedAt })
      .from(airtableSnapshots)
      .where(and(eq(airtableSnapshots.orgId, ctx.orgId), eq(airtableSnapshots.tableName, 'kpis')))
      .orderBy(desc(airtableSnapshots.syncedAt))
      .limit(1),
    db.select({ amount: additionalCharges.amount, anio: additionalCharges.anio })
      .from(additionalCharges).where(and(eq(additionalCharges.orgId, ctx.orgId), eq(additionalCharges.anio, now.getFullYear()))),
    db.select({ id: accountStatements.id, sendStatus: accountStatements.sendStatus })
      .from(accountStatements).where(eq(accountStatements.orgId, ctx.orgId)),
    db.select({ cleaningScore: tenantFeedback.cleaningScore, coexistenceScore: tenantFeedback.coexistenceScore, attentionScore: tenantFeedback.attentionScore, securityScore: tenantFeedback.securityScore, valueScore: tenantFeedback.valueScore })
      .from(tenantFeedback).where(eq(tenantFeedback.orgId, ctx.orgId)),
    db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.orgId, ctx.orgId)),
    db.select({ count: sql<number>`count(*)::int` }).from(properties).where(eq(properties.orgId, ctx.orgId)),
    db.select({ count: sql<number>`count(*)::int` }).from(paymentsTable).where(eq(paymentsTable.orgId, ctx.orgId)),
    db.select({ count: sql<number>`count(*)::int` }).from(contracts).where(eq(contracts.orgId, ctx.orgId)),
  ]);

  // Entity health — derived from counts
  type EntityName = 'tenants' | 'properties' | 'payments' | 'contracts';
  const entityHealthMap: Record<EntityName, number> = {
    tenants:    tenantCount[0]?.count ?? 0,
    properties: propertyCount[0]?.count ?? 0,
    payments:   paymentCount[0]?.count ?? 0,
    contracts:  contractCount[0]?.count ?? 0,
  };
  const unhealthyEntities = (Object.entries(entityHealthMap) as Array<[EntityName, number]>)
    .filter(([, count]) => count === 0)
    .map(([entity]) => ({ entity, count: 0, error: null }));

  const statements = (statementResult as unknown as Array<{ is_overdue: boolean; total_charged: string; total_paid: string; balance: string }>);

  // Operational KPIs
  const totalUnits = unitRows.length;
  const occupiedUnits = unitRows.filter((u) => u.status === 'occupied').length;
  const occupancyRate = computeOccupancyRate(occupiedUnits, totalUnits);

  // computeRentCollectedThisMonth expects { amount: number; paid_at: string }[]
  const paymentsForKpi = paymentRows.map((p) => ({ amount: Number(p.amount), paid_at: p.paidAt ? String(p.paidAt) : '' }));
  const rentCollected = computeRentCollectedThisMonth(paymentsForKpi);

  const overdueCount = statements.filter((s) => s.is_overdue).length;

  // Financial KPIs
  const overdueAmounts = statements
    .filter((s) => s.is_overdue)
    .map((s) => Math.max(0, Number(s.total_charged ?? 0) - Number(s.total_paid ?? 0)));
  const pastDueKpi = computePastDueBalance(overdueAmounts);

  const mtdIncome = paymentRows.filter((p) => p.paidAt && String(p.paidAt) >= startOfMonth).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const mtdExpenses = expenseRows.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const netProfitKpi = computeTrueNetProfit(mtdIncome, mtdExpenses);
  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  // Airtable occupancy delta
  const airtableRow = airtableRows[0] ?? null;
  const airtableSnapshot = airtableRow?.data
    ? {
        occupancyRate: typeof (airtableRow.data as Record<string, unknown>).occupancy_rate === 'number'
          ? ((airtableRow.data as Record<string, unknown>).occupancy_rate as number) : 0,
        syncedAt: airtableRow.syncedAt ? String(airtableRow.syncedAt) : '',
      }
    : null;
  const liveRate = totalUnits > 0 ? occupiedUnits / totalUnits : 0;

  // New Airtable KPIs
  const totalAdditionalCharges = additionalChargeRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const pendingStatements = accountStatementRows.filter((s) => s.sendStatus !== 'sent').length;

  let avgFeedback: number | null = null;
  if (feedbackRows.length > 0) {
    const allScores = feedbackRows.flatMap((r) =>
      [r.cleaningScore, r.coexistenceScore, r.attentionScore, r.securityScore, r.valueScore].filter((v): v is number => v !== null)
    );
    avgFeedback = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;
  }

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
            <KpiCard title={t('kpis.openIncidents')} value={String(incidentRows.length)} sub={t('kpis.openIncidentsSub')} color={incidentRows.length > 0 ? 'text-amber-600' : 'text-slate-600'}
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
              <AirtableOccupancyDelta liveRate={liveRate} snapshot={airtableSnapshot} />
            </div>
          </div>

          {/* Row 3 — Airtable-sourced KPIs */}
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
