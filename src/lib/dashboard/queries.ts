/**
 * src/lib/dashboard/queries.ts
 *
 * D1 (SQLite) queries behind the admin dashboard and the tenant portal
 * (W-CF-37, W-CF-38).
 *
 * R3 (docs/07-migracion-cloudflare.md): KPI aggregates run as ONE statement
 * per page, each filter backed by an `(org_id, status, ...)` index (see
 * migrations-d1/0002_dashboard_kpi_indexes.sql), and the statement's
 * `meta.rows_read` is logged so the D1 read quota per page load is measurable.
 *
 * `tenant_statement` (migrations-d1/0001_triggers.sql) exposes
 * `total_charges`, `total_approved_payments`, `balance` (REAL) and
 * `is_overdue` (0/1 INTEGER, not a boolean).
 *
 * `contracts` has no `contract_type` column (dropped with the Airtable sync), so
 * active contracts are reported as one 'unknown' bucket, as COALESCE did before.
 */

import { db } from '@/lib/db';
import { agentSessions, crmLeads, csvImports } from '@/lib/db/schema';
import { and, desc, eq, inArray, isNull, or, sql, type Column, type SQL } from 'drizzle-orm';
import { log } from '@/lib/log';

/** Runs a raw statement and logs D1 `meta.rows_read` under `page`. */
async function allWithRowsRead<T>(page: string, orgId: string, query: SQL): Promise<T[]> {
  const res = await db.run(query);
  log.info('d1 rows read', { event: 'd1_rows_read', page, orgId, rowsRead: res.meta?.rows_read ?? null });
  return (res.results ?? []) as T[];
}

/** 'YYYY-MM-DD' (date columns are TEXT) from local calendar parts — no UTC shift. */
function ymd(year: number, monthIndex: number, day: number): string {
  const d = new Date(year, monthIndex, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Admin dashboard (/dashboard) ─────────────────────────────────────────

export type DashboardKpis = {
  totalUnits: number;
  occupiedUnits: number;
  /** Approved payments with paid_at in the current month. */
  rentCollected: number;
  /** Approved payments with paid_at >= first day of the month. */
  mtdIncome: number;
  mtdExpenses: number;
  openIncidents: number;
  overdueCount: number;
  /** Sum of max(0, charges - approved payments) over overdue tenants. */
  pastDue: number;
  additionalChargesTotal: number;
  pendingStatements: number;
  avgFeedback: number | null;
  entityCounts: { tenants: number; properties: number; payments: number; contracts: number };
  contractTypes: Array<{ contractType: string; count: number }>;
  trashCompliance: Array<{ estado: string; count: number }>;
};

type DashboardKpiRow = {
  total_units: number;
  occupied_units: number;
  rent_collected: number;
  mtd_income: number;
  mtd_expenses: number;
  open_incidents: number;
  overdue_count: number;
  past_due: number;
  additional_charges_total: number;
  pending_statements: number;
  feedback_sum: number;
  feedback_count: number;
  tenant_count: number;
  property_count: number;
  payment_count: number;
  contract_count: number;
  contract_types: string;
  trash_compliance: string;
};

export async function getDashboardKpis(orgId: string, now: Date = new Date()): Promise<DashboardKpis> {
  const startOfMonth = ymd(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = ymd(now.getFullYear(), now.getMonth() + 1, 1);
  const year = now.getFullYear();

  const rows = await allWithRowsRead<DashboardKpiRow>('dashboard', orgId, sql`
    SELECT
      COALESCE(u.total_units, 0)    AS total_units,
      COALESCE(u.occupied_units, 0) AS occupied_units,
      COALESCE(p.rent_collected, 0) AS rent_collected,
      COALESCE(p.mtd_income, 0)     AS mtd_income,
      (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM expenses
        WHERE org_id = ${orgId} AND incurred_on >= ${startOfMonth}) AS mtd_expenses,
      (SELECT COUNT(*) FROM incidents WHERE org_id = ${orgId} AND status <> 'solved') AS open_incidents,
      COALESCE(s.overdue_count, 0)  AS overdue_count,
      COALESCE(s.past_due, 0)       AS past_due,
      (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM additional_charges
        WHERE org_id = ${orgId} AND anio = ${year}) AS additional_charges_total,
      (SELECT COUNT(*) FROM account_statements
        WHERE org_id = ${orgId} AND send_status IS NOT 'sent') AS pending_statements,
      COALESCE(f.feedback_sum, 0)   AS feedback_sum,
      COALESCE(f.feedback_count, 0) AS feedback_count,
      (SELECT COUNT(*) FROM tenants    WHERE org_id = ${orgId}) AS tenant_count,
      (SELECT COUNT(*) FROM properties WHERE org_id = ${orgId}) AS property_count,
      (SELECT COUNT(*) FROM payments   WHERE org_id = ${orgId}) AS payment_count,
      (SELECT COUNT(*) FROM contracts  WHERE org_id = ${orgId}) AS contract_count,
      (SELECT json_group_array(json_object('contractType', contract_type, 'count', n)) FROM (
        SELECT 'unknown' AS contract_type, COUNT(*) AS n
        FROM contracts WHERE org_id = ${orgId} AND status = 'active'
        HAVING COUNT(*) > 0
      )) AS contract_types,
      (SELECT json_group_array(json_object('estado', estado, 'count', n)) FROM (
        SELECT estado, COUNT(*) AS n
        FROM trash_compliance WHERE org_id = ${orgId} AND fecha >= ${startOfMonth}
        GROUP BY estado
      )) AS trash_compliance
    FROM
      (SELECT COUNT(*) AS total_units,
              SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied_units
         FROM units WHERE org_id = ${orgId}) u,
      (SELECT SUM(CASE WHEN paid_at < ${startOfNextMonth} THEN CAST(amount AS REAL) ELSE 0 END) AS rent_collected,
              SUM(CAST(amount AS REAL)) AS mtd_income
         FROM payments
        WHERE org_id = ${orgId} AND status = 'approved' AND paid_at >= ${startOfMonth}) p,
      (SELECT SUM(CASE WHEN is_overdue THEN 1 ELSE 0 END) AS overdue_count,
              SUM(CASE WHEN is_overdue THEN MAX(0, total_charges - total_approved_payments) ELSE 0 END) AS past_due
         FROM tenant_statement WHERE org_id = ${orgId}) s,
      (SELECT SUM(COALESCE(cleaning_score, 0) + COALESCE(coexistence_score, 0) + COALESCE(attention_score, 0)
                  + COALESCE(security_score, 0) + COALESCE(value_score, 0)) AS feedback_sum,
              SUM((cleaning_score IS NOT NULL) + (coexistence_score IS NOT NULL) + (attention_score IS NOT NULL)
                  + (security_score IS NOT NULL) + (value_score IS NOT NULL)) AS feedback_count
         FROM tenant_feedback WHERE org_id = ${orgId}) f
  `);

  const r = rows[0];
  const feedbackCount = Number(r?.feedback_count ?? 0);
  return {
    totalUnits: Number(r?.total_units ?? 0),
    occupiedUnits: Number(r?.occupied_units ?? 0),
    rentCollected: Number(r?.rent_collected ?? 0),
    mtdIncome: Number(r?.mtd_income ?? 0),
    mtdExpenses: Number(r?.mtd_expenses ?? 0),
    openIncidents: Number(r?.open_incidents ?? 0),
    overdueCount: Number(r?.overdue_count ?? 0),
    pastDue: Number(r?.past_due ?? 0),
    additionalChargesTotal: Number(r?.additional_charges_total ?? 0),
    pendingStatements: Number(r?.pending_statements ?? 0),
    avgFeedback: feedbackCount > 0 ? Number(r?.feedback_sum ?? 0) / feedbackCount : null,
    entityCounts: {
      tenants: Number(r?.tenant_count ?? 0),
      properties: Number(r?.property_count ?? 0),
      payments: Number(r?.payment_count ?? 0),
      contracts: Number(r?.contract_count ?? 0),
    },
    contractTypes: r?.contract_types ? (JSON.parse(r.contract_types) as DashboardKpis['contractTypes']) : [],
    trashCompliance: r?.trash_compliance ? (JSON.parse(r.trash_compliance) as DashboardKpis['trashCompliance']) : [],
  };
}

// ── Tenants list (/dashboard/tenants) ────────────────────────────────────

/** Overdue KPIs over `tenant_statement` for one org, as one aggregate row. */
export async function getOrgOverdueSummary(orgId: string): Promise<{ overdueCount: number; pastDue: number }> {
  const rows = await allWithRowsRead<{ overdue_count: number | null; past_due: number | null }>('dashboard/tenants', orgId, sql`
    SELECT SUM(CASE WHEN is_overdue THEN 1 ELSE 0 END) AS overdue_count,
           SUM(CASE WHEN is_overdue THEN MAX(0, total_charges - total_approved_payments) ELSE 0 END) AS past_due
      FROM tenant_statement WHERE org_id = ${orgId}
  `);
  return { overdueCount: Number(rows[0]?.overdue_count ?? 0), pastDue: Number(rows[0]?.past_due ?? 0) };
}

// ── One tenant's statement (tenant detail, portal) ───────────────────────

export type TenantStatement = {
  total_charges: number;
  total_approved_payments: number;
  balance: number;
  is_overdue: boolean;
};

/** One tenant's `tenant_statement` row, scoped to the org; null if the tenant is not in it. */
export async function getTenantStatement(orgId: string, tenantId: string): Promise<TenantStatement | null> {
  const rows = await db.all<{ total_charges: number; total_approved_payments: number; balance: number; is_overdue: number }>(sql`
    SELECT total_charges, total_approved_payments, balance, is_overdue
      FROM tenant_statement WHERE tenant_id = ${tenantId} AND org_id = ${orgId} LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    total_charges: Number(r.total_charges),
    total_approved_payments: Number(r.total_approved_payments),
    balance: Number(r.balance),
    is_overdue: Boolean(r.is_overdue),
  };
}

// ── Leads board (/dashboard/leads) ───────────────────────────────────────

/** Case-insensitive (ASCII) substring match; `%`, `_` and `\` in `q` are literal. */
export function containsLike(column: Column, q: string): SQL {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export type LeadBoardFilter = {
  orgId: string;
  pipeline: string;
  /** 'all' | 'unassigned' | advisor profile id */
  advisor: string;
  q: string;
};

export function leadBoardWhere({ orgId, pipeline, advisor, q }: LeadBoardFilter): SQL {
  const filters: SQL[] = [eq(crmLeads.orgId, orgId), eq(crmLeads.pipeline, pipeline)];
  if (advisor === 'unassigned') filters.push(isNull(crmLeads.assignedProfileId));
  else if (advisor !== 'all') filters.push(eq(crmLeads.assignedProfileId, advisor));
  if (q) filters.push(or(containsLike(crmLeads.fullName, q), containsLike(crmLeads.phone, q))!);
  return and(...filters)!;
}

export function getLeadStageCounts(where: SQL) {
  return db.select({ stage: crmLeads.stage, count: sql<number>`count(*)` })
    .from(crmLeads)
    .where(where)
    .groupBy(crmLeads.stage);
}

export function getLeadCards(where: SQL, limit: number) {
  return db.select({
    id: crmLeads.id,
    fullName: crmLeads.fullName,
    stage: crmLeads.stage,
    score: crmLeads.score,
    intentTag: crmLeads.intentTag,
    assignedProfileId: crmLeads.assignedProfileId,
    nextFollowupAt: crmLeads.nextFollowupAt,
    followupState: crmLeads.followupState,
    source: crmLeads.source,
    sourceChannel: crmLeads.sourceChannel,
    doNotContact: crmLeads.doNotContact,
    updatedAt: crmLeads.updatedAt,
  })
    .from(crmLeads)
    .where(where)
    .orderBy(desc(crmLeads.updatedAt))
    .limit(limit);
}

/**
 * Latest agent session per lead on the board. The lead ids come from a subquery
 * (same filter and limit as getLeadCards) instead of a bound IN list, which
 * would exceed D1's 100 bound parameters per statement.
 */
export async function getLatestSessionByLead(orgId: string, where: SQL, limit: number): Promise<Map<string, string>> {
  const boardLeadIds = db.select({ id: crmLeads.id })
    .from(crmLeads)
    .where(where)
    .orderBy(desc(crmLeads.updatedAt))
    .limit(limit);
  const rows = await db
    .select({ id: agentSessions.id, leadId: agentSessions.leadId })
    .from(agentSessions)
    .where(and(eq(agentSessions.orgId, orgId), inArray(agentSessions.leadId, boardLeadIds)))
    .orderBy(desc(agentSessions.updatedAt));
  const sessionByLead = new Map<string, string>();
  for (const s of rows) if (s.leadId && !sessionByLead.has(s.leadId)) sessionByLead.set(s.leadId, s.id);
  return sessionByLead;
}

// ── Import logs (/dashboard/admin/import/logs) ───────────────────────────

export async function listCsvImports(orgId: string, status: string, page: number, limit: number) {
  const where = status
    ? and(eq(csvImports.orgId, orgId), eq(csvImports.status, status))
    : eq(csvImports.orgId, orgId);
  const [countResult, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(csvImports).where(where),
    db
      .select({
        id:               csvImports.id,
        importType:       csvImports.importType,
        originalFilename: csvImports.originalFilename,
        period:           csvImports.period,
        status:           csvImports.status,
        rowCount:         csvImports.rowCount,
        failedCount:      csvImports.failedCount,
        committedAt:      csvImports.committedAt,
        createdAt:        csvImports.createdAt,
      })
      .from(csvImports)
      .where(where)
      .orderBy(desc(csvImports.createdAt))
      .limit(limit)
      .offset(page * limit),
  ]);
  return { total: countResult[0]?.count ?? 0, rows };
}
