/**
 * Weekly property summary builder.
 * Queries this ISO week's counts for tasks, payments, incidents, and sanctions.
 * Used by the /api/cron/weekly-summary route.
 *
 * Security: No PII in returned body string. Phone numbers, tenant names, etc. are excluded.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { buildWhatsAppPhase6Template } from './templates';
import { log } from '@/lib/log';

export interface WeeklySummaryCounts {
  tasksCompleted: number;
  tasksPending:   number;
  sanctions:      number;
  incidents:      number;
  payments:       number;
}

export interface WeeklySummaryResult {
  body:       string;
  counts:     WeeklySummaryCounts;
  isoWeek:    string;
  propertyName: string;
}

/**
 * Build a weekly summary for a single property.
 * All DB queries are service-role (admin client, bypasses RLS).
 */
export async function buildWeeklySummary(
  orgId: string,
  propertyId: string
): Promise<WeeklySummaryResult> {
  const adminClient = createAdminClient();

  // Get ISO week from Postgres to ensure consistent formatting
  const { data: isoRow } = await adminClient
    .rpc('get_current_iso_week')
    .single() as { data: { iso_week: string } | null; error: unknown };

  // Fallback: compute ISO week in JS if RPC not available
  const isoWeek = (isoRow as { iso_week?: string } | null)?.iso_week ?? getIsoWeek(new Date());

  // Get property name
  const { data: property } = await adminClient
    .from('properties')
    .select('name')
    .eq('id', propertyId)
    .single();

  const propertyName = property?.name ?? propertyId;

  // Query ISO-week start / end for filtering
  const weekBounds = getIsoWeekBounds(new Date());

  // Tasks completed this week
  const { count: tasksCompleted } = await adminClient
    .from('tenant_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .gte('updated_at', weekBounds.start)
    .lte('updated_at', weekBounds.end);

  // Tasks still pending
  const { count: tasksPending } = await adminClient
    .from('tenant_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending');

  // Sanctions applied this week
  const { count: sanctions } = await adminClient
    .from('sanctions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .gte('created_at', weekBounds.start)
    .lte('created_at', weekBounds.end);

  // Incidents opened this week
  const { count: incidents } = await adminClient
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .gte('created_at', weekBounds.start)
    .lte('created_at', weekBounds.end);

  // Payments received this week
  const { count: payments } = await adminClient
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .gte('created_at', weekBounds.start)
    .lte('created_at', weekBounds.end);

  const counts: WeeklySummaryCounts = {
    tasksCompleted: tasksCompleted ?? 0,
    tasksPending:   tasksPending   ?? 0,
    sanctions:      sanctions      ?? 0,
    incidents:      incidents      ?? 0,
    payments:       payments       ?? 0,
  };

  const body = buildWhatsAppPhase6Template('weeklySummaryBody', 'es', {
    propertyName,
    isoWeek,
    tasksCompleted: String(counts.tasksCompleted),
    tasksPending:   String(counts.tasksPending),
    sanctions:      String(counts.sanctions),
    incidents:      String(counts.incidents),
    payments:       String(counts.payments),
  });

  log.info('[weekly-summary] summary built', {
    orgId,
    propertyId,
    isoWeek,
    ...counts,
  });

  return { body, counts, isoWeek, propertyName };
}

// ─── ISO week helpers ─────────────────────────────────────────────────────────

/** Returns ISO week string in format "2026-W22" */
function getIsoWeek(date: Date): string {
  const d    = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day  = d.getUTCDay() || 7; // Mon=1, Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Returns UTC start (Monday 00:00) and end (Sunday 23:59:59) of the ISO week containing `date`. */
function getIsoWeekBounds(date: Date): { start: string; end: string } {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    start: monday.toISOString(),
    end:   sunday.toISOString(),
  };
}
