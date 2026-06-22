/**
 * Executive Brief page — /dashboard/executive-brief (AC12, AC14)
 *
 * Server Component. Fetches:
 *   - Current period KPIs: occupancy, true net profit MTD, past-due balance, active incidents
 *   - Prior period KPIs (same date range last month) for delta calculation
 *   - Renders KpiGrid, 4 AgentCards (1 available: Hidden Leak Detector, 3 coming_soon)
 *   - Renders Narrative section (from W7 - uses Narrative client component)
 *
 * Security:
 *   - requireAdmin() guard — redirect to /login on failure
 *   - All queries include eq(table.orgId, ctx.orgId)
 *   - No PII fetched or rendered
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { units as unitsTable, payments as paymentsTable, expenses as expensesTable, incidents } from '@/lib/db/schema';
import { eq, and, gte, lt, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { computeOccupancyRate } from '@/lib/finance/kpis';
import { KpiGrid, type KpiTileData } from '@/components/executive-brief/KpiGrid';
import { AgentCard } from '@/components/executive-brief/AgentCard';
import { LeakDetectorRunner } from '@/components/executive-brief/LeakDetectorRunner';
import { NarrativeSection } from '@/components/executive-brief/NarrativeSection';
import { runHiddenLeakDetector } from '@/app/actions/executive-brief';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = { title: 'Executive Brief | PropFlow' };

// Force dynamic so KPI data is always fresh
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// KPI helpers — compute current + prior period
// ---------------------------------------------------------------------------

function currentPeriodBounds(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end };
}

function priorPeriodBounds(): { start: string; end: string } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-indexed → previous month
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end: nextMonth };
}

interface PeriodKPIs {
  occupancyRate: number;
  trueNetProfitMTD: number;
  pastDueBalance: number;
  activeIncidents: number;
}

async function fetchPeriodKPIs(
  orgId: string,
  bounds: { start: string; end: string }
): Promise<PeriodKPIs> {
  const { start, end } = bounds;

  const [unitRows, paymentRows, expenseRows, incidentRows, statementResult] = await Promise.all([
    db.select({ id: unitsTable.id, status: unitsTable.status }).from(unitsTable).where(eq(unitsTable.orgId, orgId)),
    db
      .select({ amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, orgId), eq(paymentsTable.status, 'approved'), gte(paymentsTable.paidAt, start), lt(paymentsTable.paidAt, end))),
    db
      .select({ amount: expensesTable.amount })
      .from(expensesTable)
      .where(and(eq(expensesTable.orgId, orgId), gte(expensesTable.incurredOn, start), lt(expensesTable.incurredOn, end))),
    db
      .select({ id: incidents.id, status: incidents.status })
      .from(incidents)
      .where(and(eq(incidents.orgId, orgId), ne(incidents.status, 'solved'))),
    // tenant_statement is a PG VIEW — use raw SQL
    db.execute(sql`SELECT is_overdue, balance FROM tenant_statement WHERE org_id = ${orgId}`),
  ]);

  const totalUnits = unitRows.length;
  const occupiedUnits = unitRows.filter((u) => u.status === 'occupied').length;
  const occupancyRate = computeOccupancyRate(occupiedUnits, totalUnits);

  const grossIncome = paymentRows.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const totalExpenses = expenseRows.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const trueNetProfitMTD = Math.round((grossIncome - totalExpenses) * 100) / 100;

  const activeIncidents = incidentRows.length;

  const statements = (statementResult as unknown as Array<{ is_overdue: boolean; balance: string }>);
  const pastDueBalance = statements
    .filter((s) => s.is_overdue)
    .reduce((sum, s) => sum + Math.abs(Number(s.balance ?? 0)), 0);

  return {
    occupancyRate,
    trueNetProfitMTD: Math.round(trueNetProfitMTD * 100) / 100,
    pastDueBalance: Math.round(pastDueBalance * 100) / 100,
    activeIncidents,
  };
}

/**
 * Compute delta as percentage change: (current - prior) / |prior| * 100
 * Returns null if prior is 0.
 */
function computeDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ExecutiveBriefPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('executiveBrief');

  const [currentKPIs, priorKPIs] = await Promise.all([
    fetchPeriodKPIs(ctx.orgId, currentPeriodBounds()),
    fetchPeriodKPIs(ctx.orgId, priorPeriodBounds()),
  ]);

  const deltaSuffix = t('tiles.deltaSuffix');
  const noPriorData = t('tiles.noPriorData');

  const tiles: KpiTileData[] = [
    {
      key: 'occupancy',
      label: t('tiles.occupancy'),
      value: `${currentKPIs.occupancyRate}%`,
      rawValue: currentKPIs.occupancyRate,
      delta: computeDelta(currentKPIs.occupancyRate, priorKPIs.occupancyRate),
      positiveIsGood: true,
      sub: t('tiles.occupancySub'),
      deltaSuffix,
      noPriorData,
    },
    {
      key: 'net-profit',
      label: t('tiles.netProfit'),
      value: `$${currentKPIs.trueNetProfitMTD.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      rawValue: currentKPIs.trueNetProfitMTD,
      delta: computeDelta(currentKPIs.trueNetProfitMTD, priorKPIs.trueNetProfitMTD),
      positiveIsGood: true,
      sub: t('tiles.netProfitSub'),
      deltaSuffix,
      noPriorData,
    },
    {
      key: 'past-due',
      label: t('tiles.pastDue'),
      value: `$${currentKPIs.pastDueBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      rawValue: currentKPIs.pastDueBalance,
      delta: computeDelta(currentKPIs.pastDueBalance, priorKPIs.pastDueBalance),
      positiveIsGood: false,
      sub: t('tiles.pastDueSub'),
      deltaSuffix,
      noPriorData,
    },
    {
      key: 'incidents',
      label: t('tiles.incidents'),
      value: String(currentKPIs.activeIncidents),
      rawValue: currentKPIs.activeIncidents,
      delta: computeDelta(currentKPIs.activeIncidents, priorKPIs.activeIncidents),
      positiveIsGood: false,
      sub: t('tiles.incidentsSub'),
      deltaSuffix,
      noPriorData,
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Executive Brief</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* KPI Summary tiles — AC12 */}
      <section aria-labelledby="kpi-section-title">
        <h2 id="kpi-section-title" className="text-base font-semibold text-slate-700 mb-3">
          {t('kpiSection')}
        </h2>
        <KpiGrid tiles={tiles} />
      </section>

      {/* Agent cards — AC14 */}
      <section aria-labelledby="agents-section-title">
        <h2 id="agents-section-title" className="text-base font-semibold text-slate-700 mb-3">
          {t('agentsSection')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="agent-cards-grid">
          {/* Agent 1: Hidden Leak Detector — AVAILABLE (AC14) */}
          <LeakDetectorRunner runAction={runHiddenLeakDetector} />

          {/* Agent 2: Market Rate Auditor — coming soon */}
          <AgentCard
            id="market-rate-auditor"
            title={t('agents.marketRate.title')}
            description={t('agents.marketRate.description')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
            status="coming_soon"
          />

          {/* Agent 3: P&L Delta Analyzer — coming soon */}
          <AgentCard
            id="pnl-delta-analyzer"
            title={t('agents.pnlDelta.title')}
            description={t('agents.pnlDelta.description')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
              </svg>
            }
            status="coming_soon"
          />

          {/* Agent 4: Create Custom Agent — coming soon */}
          <AgentCard
            id="create-custom-agent"
            title={t('agents.customAgent.title')}
            description={t('agents.customAgent.description')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            }
            status="coming_soon"
          />
        </div>
      </section>

      {/* Narrative section — from W7 (AC13) */}
      <section aria-labelledby="narrative-section-title">
        <h2 id="narrative-section-title" className="text-base font-semibold text-slate-700 mb-3">
          {t('narrativeSection')}
        </h2>
        <NarrativeSection />
      </section>
    </div>
  );
}
