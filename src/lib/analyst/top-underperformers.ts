/**
 * src/lib/analyst/top-underperformers.ts
 *
 * Deterministic analyst functions — AC15.
 *
 * All functions are pure async queries against Supabase aggregates.
 * NO LLM calls are made here. NO tenant PII is returned (only unit/room identifiers).
 *
 * SERVER-ONLY: never import from client components.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RoomPerformanceRow {
  unitId: string;
  unitLabel: string;
  propertyName: string;
  billed: number;
  collected: number;
  net: number;
  lossRatio: number; // (billed - collected) / billed; 0 when billed = 0
}

export interface DebtSummary {
  totalOverdueAmount: number;
  overdueCount: number;
}

export interface ExpensesByProperty {
  propertyId: string;
  propertyName: string;
  totalExpenses: number;
}

export interface RentToMarketRow {
  unitId: string;
  unitLabel: string;
  monthlyRent: number;
  marketRate: number | null;
  gap: number | null; // monthlyRent - marketRate; null when no market data
}

export interface MonthlyTrendRow {
  period: 'current_month' | 'rolling_3_month_avg';
  revenue: number;
  expenses: number;
  net: number;
}

export interface RiskTenantRow {
  tenantId: string;
  unitLabel: string;
  overdueBalance: number;
  openIncidents: number;
  riskScore: number; // overdueBalance * 0.7 + openIncidents * 0.3 (normalized)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfMonth(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. getWorstPerformingRooms
//    Returns top-N rooms by loss ratio = (billed - collected) / billed.
//    Uses charges (billed) and payments (collected) scoped to last 30 days.
// ---------------------------------------------------------------------------

export async function getWorstPerformingRooms(
  supabase: SupabaseClient,
  orgId: string,
  topN: number = 5,
): Promise<RoomPerformanceRow[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Fetch units with property info
  const { data: units } = await supabase
    .from('units')
    .select('id, label, property_id, properties(name)')
    .eq('org_id', orgId);

  if (!units || units.length === 0) return [];

  // Fetch charges (billed) in last 30 days
  const { data: charges } = await supabase
    .from('charges')
    .select('amount, contract_id, contracts!inner(unit_id, org_id)')
    .eq('contracts.org_id', orgId)
    .gte('due_date', thirtyDaysAgo);

  // Fetch approved payments (collected) in last 30 days
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, contract_id, contracts!inner(unit_id, org_id)')
    .eq('contracts.org_id', orgId)
    .eq('status', 'approved')
    .gte('paid_at', thirtyDaysAgo);

  // Build per-unit aggregates
  const billedByUnit = new Map<string, number>();
  const collectedByUnit = new Map<string, number>();

  for (const charge of charges ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (contracts) not generically typed by the JS client; unit_id shape verified by select()
    const contract = (charge as any).contracts;
    if (!contract?.unit_id) continue;
    const prev = billedByUnit.get(contract.unit_id) ?? 0;
    billedByUnit.set(contract.unit_id, prev + (charge.amount ?? 0));
  }

  for (const payment of payments ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (contracts) not generically typed by the JS client; unit_id shape verified by select()
    const contract = (payment as any).contracts;
    if (!contract?.unit_id) continue;
    const prev = collectedByUnit.get(contract.unit_id) ?? 0;
    collectedByUnit.set(contract.unit_id, prev + (payment.amount ?? 0));
  }

  const rows: RoomPerformanceRow[] = units.map((u) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (properties) not generically typed by the JS client; name shape verified by select()
    const prop = (u as any).properties;
    const billed = billedByUnit.get(u.id) ?? 0;
    const collected = collectedByUnit.get(u.id) ?? 0;
    const net = collected - billed;
    const lossRatio = billed > 0 ? (billed - collected) / billed : 0;
    return {
      unitId: u.id,
      unitLabel: u.label ?? u.id,
      propertyName: prop?.name ?? 'Unknown',
      billed,
      collected,
      net,
      lossRatio,
    };
  });

  // Sort descending by lossRatio, return top-N
  rows.sort((a, b) => b.lossRatio - a.lossRatio);
  return rows.slice(0, topN);
}

// ---------------------------------------------------------------------------
// 2. getLostDebtThisMonth
//    Sum of overdue amounts from tenant_statement view for the org.
// ---------------------------------------------------------------------------

export async function getLostDebtThisMonth(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _orgId: string, // RLS on tenant_statement view already scopes to current org
): Promise<DebtSummary> {
  const { data: statements } = await supabase
    .from('tenant_statement')
    .select('balance, is_overdue, tenant_id');

  if (!statements) return { totalOverdueAmount: 0, overdueCount: 0 };

  // tenant_statement is a view — RLS scopes it to the current org already.
  const overdue = statements.filter(
    (s: { is_overdue: boolean; balance: number }) => s.is_overdue && s.balance < 0,
  );

  const totalOverdueAmount = overdue.reduce(
    (sum: number, s: { balance: number }) => sum + Math.abs(s.balance),
    0,
  );

  return { totalOverdueAmount, overdueCount: overdue.length };
}

// ---------------------------------------------------------------------------
// 3. getHighestExpenseProperties
//    Returns properties ranked by total expenses in last 30 days.
// ---------------------------------------------------------------------------

export async function getHighestExpenseProperties(
  supabase: SupabaseClient,
  orgId: string,
  topN: number = 5,
): Promise<ExpensesByProperty[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, property_id, properties(name)')
    .eq('org_id', orgId)
    .gte('incurred_on', thirtyDaysAgo);

  if (!expenses || expenses.length === 0) return [];

  const byProperty = new Map<string, { name: string; total: number }>();

  for (const expense of expenses) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (properties) not generically typed by the JS client; name shape verified by select()
    const prop = (expense as any).properties;
    const propId = expense.property_id ?? '__no_property__';
    const propName = prop?.name ?? 'Sin propiedad';
    const prev = byProperty.get(propId) ?? { name: propName, total: 0 };
    byProperty.set(propId, { name: propName, total: prev.total + (expense.amount ?? 0) });
  }

  const rows: ExpensesByProperty[] = Array.from(byProperty.entries()).map(
    ([propertyId, { name, total }]) => ({
      propertyId,
      propertyName: name,
      totalExpenses: total,
    }),
  );

  rows.sort((a, b) => b.totalExpenses - a.totalExpenses);
  return rows.slice(0, topN);
}

// ---------------------------------------------------------------------------
// 4. getRentToMarketGap
//    Compares monthly_rent_default per unit against market_rate column (if it
//    exists). If no market_rate column is present, gap = null and a note is
//    included in the result.
// ---------------------------------------------------------------------------

export async function getRentToMarketGap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ rows: RentToMarketRow[]; hasMarketData: boolean }> {
  // Try to fetch market_rate — if column doesn't exist, Supabase returns an error
  const { data: units, error } = await supabase
    .from('units')
    .select('id, label, monthly_rent_default, market_rate')
    .eq('org_id', orgId);

  const hasMarketData = !error && units !== null && units.some(
    (u: { market_rate: unknown }) => u.market_rate !== null && u.market_rate !== undefined,
  );

  if (!units || units.length === 0 || error) {
    return { rows: [], hasMarketData: false };
  }

  const rows: RentToMarketRow[] = units.map((u) => {
    const monthlyRent = (u as { monthly_rent_default: number }).monthly_rent_default ?? 0;
    const marketRate = (u as { market_rate: number | null }).market_rate ?? null;
    const gap = marketRate !== null ? monthlyRent - marketRate : null;
    return {
      unitId: u.id,
      unitLabel: (u as { label: string }).label ?? u.id,
      monthlyRent,
      marketRate,
      gap,
    };
  });

  return { rows, hasMarketData };
}

// ---------------------------------------------------------------------------
// 5. getMonthlyVs3MonthTrend
//    Compares current month revenue/expenses/net vs 3-month rolling average.
// ---------------------------------------------------------------------------

export async function getMonthlyVs3MonthTrend(
  supabase: SupabaseClient,
  orgId: string,
): Promise<MonthlyTrendRow[]> {
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const threeMonthsAgoStart = monthsAgo(3);

  const [{ data: currentPayments }, { data: historicPayments }, { data: currentExpenses }, { data: historicExpenses }] =
    await Promise.all([
      supabase
        .from('payments')
        .select('amount')
        .eq('org_id', orgId)
        .eq('status', 'approved')
        .gte('paid_at', currentMonthStart),
      supabase
        .from('payments')
        .select('amount')
        .eq('org_id', orgId)
        .eq('status', 'approved')
        .gte('paid_at', threeMonthsAgoStart)
        .lt('paid_at', currentMonthStart),
      supabase
        .from('expenses')
        .select('amount')
        .eq('org_id', orgId)
        .gte('incurred_on', currentMonthStart),
      supabase
        .from('expenses')
        .select('amount')
        .eq('org_id', orgId)
        .gte('incurred_on', threeMonthsAgoStart)
        .lt('incurred_on', currentMonthStart),
    ]);

  const currentRevenue = (currentPayments ?? []).reduce(
    (s: number, p: { amount: number }) => s + (p.amount ?? 0),
    0,
  );
  const currentExpensesTotal = (currentExpenses ?? []).reduce(
    (s: number, e: { amount: number }) => s + (e.amount ?? 0),
    0,
  );

  const historicRevenue3m = (historicPayments ?? []).reduce(
    (s: number, p: { amount: number }) => s + (p.amount ?? 0),
    0,
  ) / 3;
  const historicExpenses3m = (historicExpenses ?? []).reduce(
    (s: number, e: { amount: number }) => s + (e.amount ?? 0),
    0,
  ) / 3;

  return [
    {
      period: 'current_month',
      revenue: currentRevenue,
      expenses: currentExpensesTotal,
      net: currentRevenue - currentExpensesTotal,
    },
    {
      period: 'rolling_3_month_avg',
      revenue: historicRevenue3m,
      expenses: historicExpenses3m,
      net: historicRevenue3m - historicExpenses3m,
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. getHighestRiskTenants
//    Tenants with overdue payments + open incidents. No PII — only tenant IDs
//    and their linked unit label.
// ---------------------------------------------------------------------------

export async function getHighestRiskTenants(
  supabase: SupabaseClient,
  orgId: string,
  topN: number = 5,
): Promise<RiskTenantRow[]> {
  const { data: statements } = await supabase
    .from('tenant_statement')
    .select('tenant_id, balance, is_overdue');

  const { data: incidents } = await supabase
    .from('incidents')
    .select('tenant_id')
    .eq('org_id', orgId)
    .neq('status', 'solved');

  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, unit_id, units(label)')
    .eq('org_id', orgId);

  if (!tenants) return [];

  // Count open incidents per tenant
  const incidentsByTenant = new Map<string, number>();
  for (const incident of incidents ?? []) {
    if (!incident.tenant_id) continue;
    incidentsByTenant.set(
      incident.tenant_id,
      (incidentsByTenant.get(incident.tenant_id) ?? 0) + 1,
    );
  }

  // Map balance per tenant
  const balanceByTenant = new Map<string, number>();
  for (const stmt of statements ?? []) {
    if (!stmt.tenant_id || !stmt.is_overdue) continue;
    balanceByTenant.set(stmt.tenant_id, Math.abs(Math.min(0, stmt.balance)));
  }

  const rows: RiskTenantRow[] = tenants
    .filter((t) => balanceByTenant.has(t.id) || (incidentsByTenant.get(t.id) ?? 0) > 0)
    .map((t) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join (units) not generically typed by the JS client; label shape verified by select()
      const unit = (t as any).units;
      const overdueBalance = balanceByTenant.get(t.id) ?? 0;
      const openIncidents = incidentsByTenant.get(t.id) ?? 0;
      // Simple risk score — weighted sum (arbitrary weights for ranking only)
      const riskScore = overdueBalance * 0.7 + openIncidents * 30 * 0.3;
      return {
        tenantId: t.id,
        unitLabel: unit?.label ?? 'Unknown',
        overdueBalance,
        openIncidents,
        riskScore,
      };
    });

  rows.sort((a, b) => b.riskScore - a.riskScore);
  return rows.slice(0, topN);
}
