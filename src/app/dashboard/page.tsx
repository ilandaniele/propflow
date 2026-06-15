import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
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
import { checkEntityHealth, entityLabel } from '@/lib/dashboard/health';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [unitsRes, paymentsRes, incidentsRes, statementRes, expensesRes, airtableRes] =
    await Promise.all([
      supabase.from('units').select('id, status').eq('org_id', ctx.orgId),
      supabase
        .from('payments')
        .select('amount, paid_at, status')
        .eq('org_id', ctx.orgId)
        .eq('status', 'approved'),
      supabase
        .from('incidents')
        .select('id, status')
        .eq('org_id', ctx.orgId)
        .neq('status', 'solved'),
      supabase.from('tenant_statement').select('*').eq('org_id', ctx.orgId),
      supabase
        .from('expenses')
        .select('amount, incurred_on')
        .eq('org_id', ctx.orgId)
        .gte('incurred_on', startOfMonth),
      // Airtable occupancy snapshot — gracefully returns null when no rows exist
      supabase
        .from('airtable_snapshots')
        .select('data, synced_at')
        .eq('org_id', ctx.orgId)
        .eq('table_name', 'kpis')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  // Entity health check — runs in parallel with the main data fetches above.
  // Only called after requireAdmin() succeeds — admin-only data path.
  const entityHealth = await checkEntityHealth(supabase, ctx.orgId);
  const unhealthyEntities = entityHealth.filter((e) => e.count === 0 || e.error !== null);

  const units = unitsRes.data ?? [];
  const approvedPayments = paymentsRes.data ?? [];
  const openIncidents = incidentsRes.data ?? [];
  const statements = statementRes.data ?? [];
  const expenses = expensesRes.data ?? [];

  // --- Operational KPIs (existing) ---
  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
  const occupancyRate = computeOccupancyRate(occupiedUnits, totalUnits);
  const rentCollected = computeRentCollectedThisMonth(approvedPayments);
  const overdueCount = statements.filter((s) => s.is_overdue).length;

  // --- Financial KPIs (new — from kpis.ts pure functions) ---
  const overdueAmounts: number[] = statements
    .filter((s) => s.is_overdue)
    .map((s) => Math.max(0, Number(s.total_charged ?? 0) - Number(s.total_paid ?? 0)));

  const pastDueKpi = computePastDueBalance(overdueAmounts);

  // MTD income and expenses for True Net Profit
  const mtdIncome = approvedPayments
    .filter((p) => p.paid_at && p.paid_at >= startOfMonth)
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const mtdExpenses = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const netProfitKpi = computeTrueNetProfit(mtdIncome, mtdExpenses);

  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  // --- Airtable occupancy delta ---
  const airtableRow = airtableRes.data;
  const airtableSnapshot =
    airtableRow && airtableRow.data
      ? {
          occupancyRate:
            typeof (airtableRow.data as Record<string, unknown>).occupancy_rate === 'number'
              ? ((airtableRow.data as Record<string, unknown>).occupancy_rate as number)
              : 0,
          syncedAt: airtableRow.synced_at as string,
        }
      : null;

  const liveRate = totalUnits > 0 ? occupiedUnits / totalUnits : 0;

  const hasData = totalUnits > 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Your organization&apos;s overview</p>
      </div>

      {/* Diagnostic banner — admin only, only when one or more entity tables are empty or errored */}
      {unhealthyEntities.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900"
        >
          <p className="font-semibold mb-1">
            ⚠ Algunos datos no se están cargando correctamente.
          </p>
          <p className="mb-1">
            Verificá:{' '}
            {unhealthyEntities.map((e) => entityLabel(e.entity)).join(', ')}.
          </p>
          <p className="text-amber-800">
            Posibles causas: credenciales de Supabase en Vercel (
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /{' '}
            <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            ), migraciones pendientes, o perfil sin organización asignada.
          </p>
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
            title="Your dashboard is empty"
            description="Start by adding your first property to get the full picture of your portfolio."
            action={{ label: 'Add property', href: '/dashboard/properties' }}
          />
        </Card>
      ) : (
        <>
          {/* Row 1 — Operational KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Occupancy"
              value={`${occupancyRate}%`}
              sub={`${occupiedUnits} / ${totalUnits} units`}
              color="text-green-600"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
              }
            />
            <KpiCard
              title="Rent Collected"
              value={`$${rentCollected.toLocaleString()}`}
              sub="This month (approved)"
              color="text-brand-600"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
                </svg>
              }
            />
            <KpiCard
              title="Open Incidents"
              value={String(openIncidents.length)}
              sub="Not yet solved"
              color={openIncidents.length > 0 ? 'text-amber-600' : 'text-slate-600'}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                </svg>
              }
            />
            <KpiCard
              title="Overdue Tenants"
              value={String(overdueCount)}
              sub="Negative balance + past due"
              color={overdueCount > 0 ? 'text-red-600' : 'text-slate-600'}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                </svg>
              }
            />
          </div>

          {/* Row 2 — Financial KPIs (from kpis.ts pure functions) */}
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Financial KPIs (MTD)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <FinKpiCard
                title="True Net Profit"
                value={netProfitKpi.formatted}
                rawValue={netProfitKpi.value}
                sub="Income − expenses (month-to-date)"
                positiveIsGood
              />
              <FinKpiCard
                title="Past Due Balance"
                value={pastDueKpi.formatted}
                rawValue={pastDueKpi.value}
                sub="Total overdue across all tenants"
                positiveIsGood={false}
              />
              <FinKpiCard
                title="Occupancy"
                value={occupancyKpi.formatted}
                rawValue={occupancyKpi.value}
                sub={`${occupiedUnits} of ${totalUnits} units occupied`}
                positiveIsGood
              />
              {/* Airtable delta card — renders nothing when no snapshot */}
              <AirtableOccupancyDelta liveRate={liveRate} snapshot={airtableSnapshot} />
            </div>
          </div>
        </>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <QuickAction href="/dashboard/tenants" label="Manage Tenants" description="Add, edit, and assign tenants to units" />
        <QuickAction href="/dashboard/payments" label="Approve Payments" description="Review and approve pending payments" />
        <QuickAction href="/dashboard/incidents" label="Resolve Incidents" description="Assign and progress open incidents" />
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

function FinKpiCard({
  title,
  value,
  rawValue,
  sub,
  positiveIsGood,
}: {
  title: string;
  value: string;
  rawValue: number;
  sub: string;
  positiveIsGood: boolean;
}) {
  const valueColor =
    rawValue > 0 && positiveIsGood
      ? 'text-green-700'
      : rawValue < 0 || (!positiveIsGood && rawValue > 0)
      ? 'text-red-600'
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
    <Link
      href={href}
      className="group block bg-white rounded-xl border border-slate-200 p-5 hover:border-brand-300 hover:shadow-md transition-all duration-150"
    >
      <p className="font-semibold text-slate-900 text-sm mb-1 group-hover:text-brand-700 transition-colors">{label}</p>
      <p className="text-xs text-slate-500">{description}</p>
    </Link>
  );
}
