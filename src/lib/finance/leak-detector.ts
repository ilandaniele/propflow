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
 * The function is PURE from the caller's perspective: it accepts a Supabase
 * client (RLS-scoped) and returns a typed array. No LLM, no side effects.
 *
 * Threshold: (billed - collected) / billed > 0.15
 *
 * Used by:
 *   - src/app/dashboard/executive-brief/page.tsx via AgentCard "Hidden Leak Detector"
 *   - tests/unit/finance/leak-detector.test.ts (AC14 unit tests)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Severity thresholds for gap size */
const SEVERITY_HIGH_THRESHOLD = 0.35;   // >35% gap → high
const SEVERITY_MEDIUM_THRESHOLD = 0.15; // >15% gap → medium

export type LeakSeverity = 'medium' | 'high';

export interface LeakFinding {
  /** Supabase unit id */
  unitId: string;
  /** Human-readable unit label (e.g. "Room 3A") */
  unitLabel: string;
  /** Total billed across all charges for this unit in the period */
  billedTotal: number;
  /** Total collected via approved payments for this unit in the period */
  collectedTotal: number;
  /** Absolute gap: billedTotal - collectedTotal */
  amount: number;
  /** Gap ratio: amount / billedTotal (0–1) */
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

/**
 * Returns the ISO date of the first day of the current month.
 */
function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Returns the ISO date of the first day of the next month.
 */
function nextMonthStart(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  if (month === 11) {
    return `${year + 1}-01-01`;
  }
  return `${year}-${String(month + 2).padStart(2, '0')}-01`;
}

/**
 * Detect units where the gap between billed and collected exceeds 15%.
 *
 * @param supabase RLS-scoped Supabase client (user-scoped, not service-role).
 *                 The caller is responsible for ensuring the client is scoped
 *                 to the correct org via RLS policies.
 * @param options  Optional date range. Defaults to current month.
 * @returns        Array of LeakFinding (may be empty if no leaks found).
 */
export async function detectHiddenLeaks(
  supabase: SupabaseClient,
  options: DetectLeaksOptions = {}
): Promise<LeakFinding[]> {
  const periodStart = options.periodStart ?? currentMonthStart();
  const periodEnd = options.periodEnd ?? nextMonthStart();

  // Fetch all units with their label (RLS-scoped to the current org)
  const { data: units, error: unitsError } = await supabase
    .from('units')
    .select('id, label');

  if (unitsError || !units) {
    // Return empty on error — caller can decide to surface it
    return [];
  }

  if (units.length === 0) {
    return [];
  }

  const unitIds = units.map((u: { id: string }) => u.id);

  // Fetch charges (billed) for these units within the period
  const { data: charges, error: chargesError } = await supabase
    .from('charges')
    .select('id, tenant_id, amount')
    .in('tenant_id', await getTenantIdsByUnitIds(supabase, unitIds))
    .gte('due_date', periodStart)
    .lt('due_date', periodEnd);

  if (chargesError) {
    return [];
  }

  // Fetch approved payments for these units within the period
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('id, contract_id, amount, paid_at')
    .eq('status', 'approved')
    .gte('paid_at', periodStart)
    .lt('paid_at', periodEnd);

  if (paymentsError) {
    return [];
  }

  // Map contract_id → unit_id via contracts table
  const contractIds = [...new Set((payments ?? []).map((p: { contract_id: string }) => p.contract_id))];
  const contractUnitMap: Map<string, string> = new Map();

  if (contractIds.length > 0) {
    const { data: contracts } = await supabase
      .from('contracts')
      .select('id, unit_id')
      .in('id', contractIds);

    if (contracts) {
      for (const c of contracts as Array<{ id: string; unit_id: string }>) {
        contractUnitMap.set(c.id, c.unit_id);
      }
    }
  }

  // Map tenant_id → unit_id via tenants table (for charges)
  const tenantIds = [...new Set((charges ?? []).map((c: { tenant_id: string }) => c.tenant_id).filter(Boolean))];
  const tenantUnitMap: Map<string, string> = new Map();

  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, unit_id')
      .in('id', tenantIds);

    if (tenants) {
      for (const t of tenants as Array<{ id: string; unit_id: string | null }>) {
        if (t.unit_id) tenantUnitMap.set(t.id, t.unit_id);
      }
    }
  }

  // Aggregate billed and collected per unit
  const billedByUnit = new Map<string, number>();
  const collectedByUnit = new Map<string, number>();

  // Initialize all units to 0
  for (const unit of units as Array<{ id: string }>) {
    billedByUnit.set(unit.id, 0);
    collectedByUnit.set(unit.id, 0);
  }

  // Accumulate charges (billed)
  for (const charge of (charges ?? []) as Array<{ tenant_id: string; amount: number }>) {
    const unitId = tenantUnitMap.get(charge.tenant_id);
    if (unitId) {
      billedByUnit.set(unitId, (billedByUnit.get(unitId) ?? 0) + (charge.amount ?? 0));
    }
  }

  // Accumulate approved payments (collected)
  for (const payment of (payments ?? []) as Array<{ contract_id: string; amount: number }>) {
    const unitId = contractUnitMap.get(payment.contract_id);
    if (unitId) {
      collectedByUnit.set(unitId, (collectedByUnit.get(unitId) ?? 0) + (payment.amount ?? 0));
    }
  }

  // Find leaks: (billed - collected) / billed > 15% AND amount > 0
  const findings: LeakFinding[] = [];

  for (const unit of units as Array<{ id: string; label: string }>) {
    const billed = billedByUnit.get(unit.id) ?? 0;
    const collected = collectedByUnit.get(unit.id) ?? 0;
    const gap = billed - collected;

    // Only flag if billed > 0 and gap > 0 and ratio > LEAK_THRESHOLD
    if (billed <= 0 || gap <= 0) continue;

    const gapRatio = gap / billed;

    if (gapRatio <= SEVERITY_MEDIUM_THRESHOLD) continue;

    const severity: LeakSeverity = gapRatio > SEVERITY_HIGH_THRESHOLD ? 'high' : 'medium';

    findings.push({
      unitId: unit.id,
      unitLabel: unit.label ?? unit.id,
      billedTotal: round2(billed),
      collectedTotal: round2(collected),
      amount: round2(gap),
      gapRatio: Math.round(gapRatio * 1000) / 1000,
      severity,
      description: buildDescription(unit.label ?? unit.id, billed, collected, gap, gapRatio),
    });
  }

  // Sort by gap ratio descending (worst leaks first)
  return findings.sort((a, b) => b.gapRatio - a.gapRatio);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Helper: get tenant IDs for a set of unit IDs.
 * Returns an empty array if no tenants found (avoids empty IN clause).
 */
async function getTenantIdsByUnitIds(
  supabase: SupabaseClient,
  unitIds: string[]
): Promise<string[]> {
  if (unitIds.length === 0) return [];
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .in('unit_id', unitIds);
  return (data ?? []).map((t: { id: string }) => t.id);
}
