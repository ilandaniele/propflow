/**
 * src/lib/analyst/top-underperformers.ts
 *
 * Deterministic analyst functions — AC15.
 *
 * All functions are pure async queries against Drizzle aggregates.
 * NO LLM calls are made here. NO tenant PII is returned (only unit/room identifiers).
 *
 * SERVER-ONLY: never import from client components.
 *
 * Migrated from Supabase client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { units, charges, payments, contracts, expenses, tenants, incidents } from '@/lib/db/schema';
import { eq, and, gte, lt, neq, inArray, sql } from 'drizzle-orm';

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
  riskScore: number;
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
// ---------------------------------------------------------------------------

export async function getWorstPerformingRooms(
  orgId: string,
  topN: number = 5,
): Promise<RoomPerformanceRow[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Fetch units with property name via join
  const unitRows = await db
    .select({
      id: units.id,
      label: units.label,
      propertyId: units.propertyId,
      propertyName: sql<string>`p.name`.as('propertyName'),
    })
    .from(units)
    .leftJoin(sql`properties p ON p.id = ${units.propertyId}`)
    .where(eq(units.orgId, orgId));

  if (unitRows.length === 0) return [];

  const unitIds = unitRows.map((u) => u.id);

  // Fetch contracts for these units to get contractId→unitId mapping
  const contractRows = await db
    .select({ id: contracts.id, unitId: contracts.unitId })
    .from(contracts)
    .where(and(eq(contracts.orgId, orgId), inArray(contracts.unitId, unitIds)));

  const contractIds = contractRows.map((c) => c.id);
  const contractUnitMap = new Map<string, string>();
  for (const c of contractRows) contractUnitMap.set(c.id, c.unitId);

  // Fetch charges in last 30 days for these contracts
  const chargeRows = contractIds.length > 0
    ? await db
        .select({ contractId: charges.contractId, amount: charges.amount })
        .from(charges)
        .where(and(
          eq(charges.orgId, orgId),
          inArray(charges.contractId, contractIds),
          gte(charges.dueDate, thirtyDaysAgo),
        ))
    : [];

  // Fetch approved payments in last 30 days for these contracts
  const paymentRows = contractIds.length > 0
    ? await db
        .select({ contractId: payments.contractId, amount: payments.amount })
        .from(payments)
        .where(and(
          eq(payments.orgId, orgId),
          inArray(payments.contractId, contractIds),
          eq(payments.status, 'approved'),
          gte(payments.paidAt, thirtyDaysAgo),
        ))
    : [];

  // Aggregate per unit
  const billedByUnit = new Map<string, number>();
  const collectedByUnit = new Map<string, number>();
  for (const u of unitRows) {
    billedByUnit.set(u.id, 0);
    collectedByUnit.set(u.id, 0);
  }

  for (const c of chargeRows) {
    const unitId = contractUnitMap.get(c.contractId);
    if (unitId) billedByUnit.set(unitId, (billedByUnit.get(unitId) ?? 0) + Number(c.amount ?? 0));
  }

  for (const p of paymentRows) {
    const unitId = contractUnitMap.get(p.contractId);
    if (unitId) collectedByUnit.set(unitId, (collectedByUnit.get(unitId) ?? 0) + Number(p.amount ?? 0));
  }

  const rows: RoomPerformanceRow[] = unitRows.map((u) => {
    const billed = billedByUnit.get(u.id) ?? 0;
    const collected = collectedByUnit.get(u.id) ?? 0;
    const net = collected - billed;
    const lossRatio = billed > 0 ? (billed - collected) / billed : 0;
    return {
      unitId: u.id,
      unitLabel: u.label ?? u.id,
      propertyName: u.propertyName ?? 'Unknown',
      billed,
      collected,
      net,
      lossRatio,
    };
  });

  rows.sort((a, b) => b.lossRatio - a.lossRatio);
  return rows.slice(0, topN);
}

// ---------------------------------------------------------------------------
// 2. getLostDebtThisMonth — uses tenant_statement PG view via raw SQL
// ---------------------------------------------------------------------------

export async function getLostDebtThisMonth(
  orgId: string,
): Promise<DebtSummary> {
  const rows = await db.execute(
    sql`SELECT is_overdue, balance FROM tenant_statement WHERE org_id = ${orgId}`
  ) as unknown as Array<{ is_overdue: boolean; balance: string | number }>;

  const overdue = rows.filter((s) => s.is_overdue && Number(s.balance) < 0);
  const totalOverdueAmount = overdue.reduce(
    (sum, s) => sum + Math.abs(Number(s.balance)),
    0,
  );

  return { totalOverdueAmount, overdueCount: overdue.length };
}

// ---------------------------------------------------------------------------
// 3. getHighestExpenseProperties
// ---------------------------------------------------------------------------

export async function getHighestExpenseProperties(
  orgId: string,
  topN: number = 5,
): Promise<ExpensesByProperty[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const expenseRows = await db
    .select({
      amount: expenses.amount,
      propertyId: expenses.propertyId,
      propertyName: sql<string>`p.name`.as('propertyName'),
    })
    .from(expenses)
    .leftJoin(sql`properties p ON p.id = ${expenses.propertyId}`)
    .where(and(eq(expenses.orgId, orgId), gte(expenses.incurredOn, thirtyDaysAgo)));

  if (expenseRows.length === 0) return [];

  const byProperty = new Map<string, { name: string; total: number }>();
  for (const e of expenseRows) {
    const propId = e.propertyId ?? '__no_property__';
    const propName = e.propertyName ?? 'Sin propiedad';
    const prev = byProperty.get(propId) ?? { name: propName, total: 0 };
    byProperty.set(propId, { name: propName, total: prev.total + Number(e.amount ?? 0) });
  }

  const result: ExpensesByProperty[] = Array.from(byProperty.entries()).map(
    ([propertyId, { name, total }]) => ({ propertyId, propertyName: name, totalExpenses: total }),
  );

  result.sort((a, b) => b.totalExpenses - a.totalExpenses);
  return result.slice(0, topN);
}

// ---------------------------------------------------------------------------
// 4. getRentToMarketGap
// ---------------------------------------------------------------------------

export async function getRentToMarketGap(
  orgId: string,
): Promise<{ rows: RentToMarketRow[]; hasMarketData: boolean }> {
  // market_rate column may not exist — use try/catch
  try {
    const unitRows = await db.execute(
      sql`SELECT id, label, monthly_rent_default, market_rate FROM units WHERE org_id = ${orgId}`
    ) as unknown as Array<{
      id: string;
      label: string | null;
      monthly_rent_default: string | number | null;
      market_rate: string | number | null;
    }>;

    if (!unitRows || unitRows.length === 0) return { rows: [], hasMarketData: false };

    const hasMarketData = unitRows.some(
      (u) => u.market_rate !== null && u.market_rate !== undefined,
    );

    const rows: RentToMarketRow[] = unitRows.map((u) => {
      const monthlyRent = Number(u.monthly_rent_default ?? 0);
      const marketRate = u.market_rate !== null ? Number(u.market_rate) : null;
      const gap = marketRate !== null ? monthlyRent - marketRate : null;
      return {
        unitId: u.id,
        unitLabel: u.label ?? u.id,
        monthlyRent,
        marketRate,
        gap,
      };
    });

    return { rows, hasMarketData };
  } catch {
    return { rows: [], hasMarketData: false };
  }
}

// ---------------------------------------------------------------------------
// 5. getMonthlyVs3MonthTrend
// ---------------------------------------------------------------------------

export async function getMonthlyVs3MonthTrend(
  orgId: string,
): Promise<MonthlyTrendRow[]> {
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const threeMonthsAgoStart = monthsAgo(3);

  const [currentPaymentRows, historicPaymentRows, currentExpenseRows, historicExpenseRows] =
    await Promise.all([
      db.select({ amount: payments.amount })
        .from(payments)
        .where(and(eq(payments.orgId, orgId), eq(payments.status, 'approved'), gte(payments.paidAt, currentMonthStart))),
      db.select({ amount: payments.amount })
        .from(payments)
        .where(and(
          eq(payments.orgId, orgId),
          eq(payments.status, 'approved'),
          gte(payments.paidAt, threeMonthsAgoStart),
          lt(payments.paidAt, currentMonthStart),
        )),
      db.select({ amount: expenses.amount })
        .from(expenses)
        .where(and(eq(expenses.orgId, orgId), gte(expenses.incurredOn, currentMonthStart))),
      db.select({ amount: expenses.amount })
        .from(expenses)
        .where(and(
          eq(expenses.orgId, orgId),
          gte(expenses.incurredOn, threeMonthsAgoStart),
          lt(expenses.incurredOn, currentMonthStart),
        )),
    ]);

  const currentRevenue = currentPaymentRows.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const currentExpensesTotal = currentExpenseRows.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const historicRevenue3m = historicPaymentRows.reduce((s, p) => s + Number(p.amount ?? 0), 0) / 3;
  const historicExpenses3m = historicExpenseRows.reduce((s, e) => s + Number(e.amount ?? 0), 0) / 3;

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
// ---------------------------------------------------------------------------

export async function getHighestRiskTenants(
  orgId: string,
  topN: number = 5,
): Promise<RiskTenantRow[]> {
  const [statementRows, incidentRows, tenantRows] = await Promise.all([
    db.execute(
      sql`SELECT tenant_id, balance, is_overdue FROM tenant_statement WHERE org_id = ${orgId}`
    ) as Promise<unknown>,
    db.select({ tenantId: incidents.tenantId })
      .from(incidents)
      .where(and(eq(incidents.orgId, orgId), neq(incidents.status, 'solved'))),
    db.select({ id: tenants.id, unitId: tenants.unitId, unitLabel: sql<string>`u.label`.as('unitLabel') })
      .from(tenants)
      .leftJoin(sql`units u ON u.id = ${tenants.unitId}`)
      .where(eq(tenants.orgId, orgId)),
  ]);

  const stmts = statementRows as Array<{ tenant_id: string | null; balance: string | number; is_overdue: boolean }>;

  const incidentsByTenant = new Map<string, number>();
  for (const inc of incidentRows) {
    if (!inc.tenantId) continue;
    incidentsByTenant.set(inc.tenantId, (incidentsByTenant.get(inc.tenantId) ?? 0) + 1);
  }

  const balanceByTenant = new Map<string, number>();
  for (const s of stmts) {
    if (!s.tenant_id || !s.is_overdue) continue;
    balanceByTenant.set(s.tenant_id, Math.abs(Math.min(0, Number(s.balance))));
  }

  const result: RiskTenantRow[] = (tenantRows as Array<{ id: string; unitId: string | null; unitLabel: string | null }>)
    .filter((t) => balanceByTenant.has(t.id) || (incidentsByTenant.get(t.id) ?? 0) > 0)
    .map((t) => {
      const overdueBalance = balanceByTenant.get(t.id) ?? 0;
      const openIncidents = incidentsByTenant.get(t.id) ?? 0;
      const riskScore = overdueBalance * 0.7 + openIncidents * 30 * 0.3;
      return {
        tenantId: t.id,
        unitLabel: t.unitLabel ?? 'Unknown',
        overdueBalance,
        openIncidents,
        riskScore,
      };
    });

  result.sort((a, b) => b.riskScore - a.riskScore);
  return result.slice(0, topN);
}
