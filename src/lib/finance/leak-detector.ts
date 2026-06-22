/**
 * src/lib/finance/leak-detector.ts
 *
 * detectHiddenLeaks — deterministic hidden-leak detector (AC14).
 *
 * Logic:
 *   For each unit in the org, compare the total billed amount (charges) vs the
 *   total collected amount (approved payments). If the gap exceeds 15% of the
 *   billed total AND the absolute gap > 0, flag it as a LeakFinding.
 *
 * The function is PURE from the caller's perspective: returns a typed array.
 * No LLM, no side effects.
 *
 * Threshold: (billed - collected) / billed > 0.15
 *
 * Used by:
 *   - src/app/actions/executive-brief.ts via runHiddenLeakDetector()
 *   - src/app/dashboard/executive-brief/page.tsx via AgentCard "Hidden Leak Detector"
 *   - tests/unit/finance/leak-detector.test.ts (AC14 unit tests)
 *
 * Migrated from Supabase client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { units, charges, payments, contracts, tenants } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray } from 'drizzle-orm';

/** Severity thresholds for gap size */
const SEVERITY_HIGH_THRESHOLD = 0.35;   // >35% gap → high
const SEVERITY_MEDIUM_THRESHOLD = 0.15; // >15% gap → medium

export type LeakSeverity = 'medium' | 'high';

export interface LeakFinding {
  unitId: string;
  unitLabel: string;
  billedTotal: number;
  collectedTotal: number;
  amount: number;
  gapRatio: number;
  severity: LeakSeverity;
  description: string;
}

export interface DetectLeaksOptions {
  /** ISO date string for start of period (inclusive). Defaults to first day of current month. */
  periodStart?: string;
  /** ISO date string for end of period (exclusive). Defaults to first day of next month. */
  periodEnd?: string;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function nextMonthStart(): string {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  if (month === 11) return `${year + 1}-01-01`;
  return `${year}-${String(month + 2).padStart(2, '0')}-01`;
}

/**
 * Detect units where the gap between billed and collected exceeds 15%.
 * orgId is required for AC8 isolation — every query includes eq(table.orgId, orgId).
 *
 * @param orgId   Organization UUID — required for org isolation.
 * @param options Optional date range. Defaults to current month.
 * @returns       Array of LeakFinding (may be empty if no leaks found).
 */
export async function detectHiddenLeaks(
  orgId: string,
  options: DetectLeaksOptions = {}
): Promise<LeakFinding[]> {
  const periodStart = options.periodStart ?? currentMonthStart();
  const periodEnd = options.periodEnd ?? nextMonthStart();

  // Fetch all units for org
  const unitRows = await db
    .select({ id: units.id, label: units.label })
    .from(units)
    .where(eq(units.orgId, orgId));

  if (unitRows.length === 0) return [];

  const unitIds = unitRows.map((u) => u.id);

  // Fetch tenant IDs by unit
  const tenantRows = await db
    .select({ id: tenants.id, unitId: tenants.unitId })
    .from(tenants)
    .where(and(eq(tenants.orgId, orgId), inArray(tenants.unitId, unitIds)));

  const tenantIds = tenantRows.map((t) => t.id);
  if (tenantIds.length === 0) return [];

  // Fetch charges (billed) within period
  const chargeRows = await db
    .select({ tenantId: charges.tenantId, amount: charges.amount })
    .from(charges)
    .where(and(
      eq(charges.orgId, orgId),
      inArray(charges.tenantId, tenantIds),
      gte(charges.dueDate, periodStart),
      lt(charges.dueDate, periodEnd),
    ));

  // Fetch approved payments within period via contracts
  const paymentRows = await db
    .select({ contractId: payments.contractId, amount: payments.amount })
    .from(payments)
    .where(and(
      eq(payments.orgId, orgId),
      eq(payments.status, 'approved'),
      gte(payments.paidAt, periodStart),
      lt(payments.paidAt, periodEnd),
    ));

  // Map contract_id → unit_id via contracts table
  const contractIds = [...new Set(paymentRows.map((p) => p.contractId).filter(Boolean) as string[])];
  const contractUnitMap = new Map<string, string>();
  if (contractIds.length > 0) {
    const contractRows = await db
      .select({ id: contracts.id, unitId: contracts.unitId })
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), inArray(contracts.id, contractIds)));
    for (const c of contractRows) {
      contractUnitMap.set(c.id, c.unitId);
    }
  }

  // Map tenant_id → unit_id
  const tenantUnitMap = new Map<string, string>();
  for (const t of tenantRows) {
    if (t.unitId) tenantUnitMap.set(t.id, t.unitId);
  }

  // Aggregate billed and collected per unit
  const billedByUnit = new Map<string, number>();
  const collectedByUnit = new Map<string, number>();
  for (const u of unitRows) {
    billedByUnit.set(u.id, 0);
    collectedByUnit.set(u.id, 0);
  }

  for (const c of chargeRows) {
    const unitId = tenantUnitMap.get(c.tenantId);
    if (unitId) {
      billedByUnit.set(unitId, (billedByUnit.get(unitId) ?? 0) + Number(c.amount ?? 0));
    }
  }

  for (const p of paymentRows) {
    if (!p.contractId) continue;
    const unitId = contractUnitMap.get(p.contractId);
    if (unitId) {
      collectedByUnit.set(unitId, (collectedByUnit.get(unitId) ?? 0) + Number(p.amount ?? 0));
    }
  }

  const findings: LeakFinding[] = [];

  for (const unit of unitRows) {
    const billed = billedByUnit.get(unit.id) ?? 0;
    const collected = collectedByUnit.get(unit.id) ?? 0;
    const gap = billed - collected;

    if (billed <= 0 || gap <= 0) continue;

    const gapRatio = gap / billed;

    if (gapRatio <= SEVERITY_MEDIUM_THRESHOLD) continue;

    const severity: LeakSeverity = gapRatio > SEVERITY_HIGH_THRESHOLD ? 'high' : 'medium';
    const label = unit.label ?? unit.id;

    findings.push({
      unitId: unit.id,
      unitLabel: label,
      billedTotal: round2(billed),
      collectedTotal: round2(collected),
      amount: round2(gap),
      gapRatio: Math.round(gapRatio * 1000) / 1000,
      severity,
      description: buildDescription(label, billed, collected, gap, gapRatio),
    });
  }

  return findings.sort((a, b) => b.gapRatio - a.gapRatio);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildDescription(
  unitLabel: string,
  billed: number,
  collected: number,
  gap: number,
  gapRatio: number
): string {
  const pct = Math.round(gapRatio * 100);
  return `${unitLabel}: facturado $${billed.toFixed(2)}, cobrado $${collected.toFixed(2)}, diferencia $${gap.toFixed(2)} (${pct}%)`;
}
