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
 *   - All queries use createClient() (RLS-scoped, anon key)
 *   - No PII fetched or rendered
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { computeOccupancyRate } from '@/lib/kpi';
import { KpiGrid, type KpiTileData } from '@/components/executive-brief/KpiGrid';
import { AgentCard } from '@/components/executive-brief/AgentCard';
import { LeakDetectorRunner } from '@/components/executive-brief/LeakDetectorRunner';
import { NarrativeSection } from '@/components/executive-brief/NarrativeSection';
import { runHiddenLeakDetector } from '@/app/actions/executive-brief';

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
  let month = now.getMonth(); // 0-indexed → previous month is month
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  bounds: { start: string; end: string }
): Promise<PeriodKPIs> {
  const { start, end } = bounds;

  const [
    { data: units },
    { data: payments },
    { data: expenses },
    { data: incidents },
    { data: statements },
  ] = await Promise.all([
    supabase.from('units').select('id, status'),
    supabase
      .from('payments')
      .select('amount, paid_at')
      .eq('status', 'approved')
      .gte('paid_at', start)
      .lt('paid_at', end),
    supabase
      .from('expenses')
      .select('amount')
      .gte('incurred_on', start)
      .lt('incurred_on', end),
    supabase
      .from('incidents')
      .select('id, status')
      .neq('status', 'solved'),
    supabase.from('tenant_statement').select('is_overdue, balance'),
  ]);

  const totalUnits = (units ?? []).length;
  const occupiedUnits = (units ?? []).filter((u: { status: string }) => u.status === 'occupied').length;
  const occupancyRate = computeOccupancyRate(occupiedUnits, totalUnits);

  const grossIncome = (payments ?? []).reduce((s: number, p: { amount: number }) => s + (p.amount ?? 0), 0);
  const totalExpenses = (expenses ?? []).reduce((s: number, e: { amount: number }) => s + (e.amount ?? 0), 0);
  const trueNetProfitMTD = Math.round((grossIncome - totalExpenses) * 100) / 100;

  const activeIncidents = (incidents ?? []).length;

  // Past due balance = sum of negative balances on overdue tenant statements
  const pastDueBalance = (statements ?? [])
    .filter((s: { is_overdue: boolean }) => s.is_overdue)
    .reduce((sum: number, s: { balance: number | null }) => sum + Math.abs(s.balance ?? 0), 0);

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
  try {
    await requireAdmin();
  } catch {
    redirect('/login');
  }

  const supabase = await createClient();

  const [currentKPIs, priorKPIs] = await Promise.all([
    fetchPeriodKPIs(supabase, currentPeriodBounds()),
    fetchPeriodKPIs(supabase, priorPeriodBounds()),
  ]);

  const tiles: KpiTileData[] = [
    {
      key: 'occupancy',
      label: 'Ocupación',
      value: `${currentKPIs.occupancyRate}%`,
      rawValue: currentKPIs.occupancyRate,
      delta: computeDelta(currentKPIs.occupancyRate, priorKPIs.occupancyRate),
      positiveIsGood: true,
      sub: 'Tasa de ocupación actual',
    },
    {
      key: 'net-profit',
      label: 'Ganancia Neta MTD',
      value: `$${currentKPIs.trueNetProfitMTD.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      rawValue: currentKPIs.trueNetProfitMTD,
      delta: computeDelta(currentKPIs.trueNetProfitMTD, priorKPIs.trueNetProfitMTD),
      positiveIsGood: true,
      sub: 'Ingresos - Gastos (mes actual)',
    },
    {
      key: 'past-due',
      label: 'Balance Vencido',
      value: `$${currentKPIs.pastDueBalance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      rawValue: currentKPIs.pastDueBalance,
      delta: computeDelta(currentKPIs.pastDueBalance, priorKPIs.pastDueBalance),
      positiveIsGood: false, // higher past-due = worse
      sub: 'Suma de saldos vencidos',
    },
    {
      key: 'incidents',
      label: 'Incidentes Abiertos',
      value: String(currentKPIs.activeIncidents),
      rawValue: currentKPIs.activeIncidents,
      delta: computeDelta(currentKPIs.activeIncidents, priorKPIs.activeIncidents),
      positiveIsGood: false, // higher incidents = worse
      sub: 'Incidentes no resueltos',
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Executive Brief</h1>
        <p className="text-sm text-slate-500 mt-1">
          Resumen ejecutivo del portfolio — datos actualizados en tiempo real
        </p>
      </div>

      {/* KPI Summary tiles — AC12 */}
      <section aria-labelledby="kpi-section-title">
        <h2
          id="kpi-section-title"
          className="text-base font-semibold text-slate-700 mb-3"
        >
          KPIs del Mes
        </h2>
        <KpiGrid tiles={tiles} />
      </section>

      {/* Agent cards — AC14 */}
      <section aria-labelledby="agents-section-title">
        <h2
          id="agents-section-title"
          className="text-base font-semibold text-slate-700 mb-3"
        >
          Agentes de Análisis
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="agent-cards-grid">
          {/* Agent 1: Hidden Leak Detector — AVAILABLE (AC14) */}
          <LeakDetectorRunner runAction={runHiddenLeakDetector} />

          {/* Agent 2: Market Rate Auditor — coming soon */}
          <AgentCard
            id="market-rate-auditor"
            title="Market Rate Auditor"
            description="Compara las tarifas de tus unidades con el mercado para identificar oportunidades de mejora."
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
            status="coming_soon"
          />

          {/* Agent 3: P&L Delta Analyzer — coming soon */}
          <AgentCard
            id="pnl-delta-analyzer"
            title="P&L Delta Analyzer"
            description="Analiza las variaciones de ingresos y gastos entre periodos para identificar tendencias."
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            }
            status="coming_soon"
          />

          {/* Agent 4: Create Custom Agent — coming soon */}
          <AgentCard
            id="create-custom-agent"
            title="Create Custom Agent"
            description="Diseña tu propio agente de análisis personalizado para las necesidades de tu portfolio."
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            }
            status="coming_soon"
          />
        </div>
      </section>

      {/* Narrative section — from W7 (AC13) */}
      <section aria-labelledby="narrative-section-title">
        <h2
          id="narrative-section-title"
          className="text-base font-semibold text-slate-700 mb-3"
        >
          Narrativa IA
        </h2>
        <NarrativeSection />
      </section>
    </div>
  );
}
