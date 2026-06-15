/**
 * Weekly property summary builder.
 * Queries this ISO week's counts for tasks, payments, incidents, and sanctions.
 * Used by the /api/cron/weekly-summary route.
 *
 * Security: No PII in returned body string. Phone numbers, tenant names, etc. are excluded.
 *
 * W6: replaced createAdminClient() / Supabase queries with Drizzle db.
 */

import { db } from '@/lib/db';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  properties,
  tenantTasks,
  sanctions,
  incidents,
  payments,
} from '@/lib/db/schema';
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
  body:         string;
  counts:       WeeklySummaryCounts;
  isoWeek:      string;
  propertyName: string;
}

/**
 * Build a weekly summary for a single property.
 * All DB queries are org-scoped via Drizzle.
 */
export async function buildWeeklySummary(
  orgId: string,
  propertyId: string
): Promise<WeeklySummaryResult> {
  const isoWeek = getIsoWeek(new Date());
  const weekBounds = getIsoWeekBounds(new Date());

  // Get property name
  const propertyRows = await db
    .select({ name: properties.name })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.orgId, orgId)))
    .limit(1);

  const propertyName = propertyRows[0]?.name ?? propertyId;

  // Query counts in parallel
  const [
    tasksCompletedRows,
    tasksPendingRows,
    sanctionRows,
    incidentRows,
    paymentRows,
  ] = await Promise.all([
    // Tasks completed this week
    db
      .select({ id: tenantTasks.id })
      .from(tenantTasks)
      .where(and(
        eq(tenantTasks.orgId, orgId),
        eq(tenantTasks.status, 'completed'),
        gte(tenantTasks.updatedAt, new Date(weekBounds.start)),
        lte(tenantTasks.updatedAt, new Date(weekBounds.end)),
      )),

    // Tasks still pending
    db
      .select({ id: tenantTasks.id })
      .from(tenantTasks)
      .where(and(
        eq(tenantTasks.orgId, orgId),
        eq(tenantTasks.status, 'pending'),
      )),

    // Sanctions applied this week
    db
      .select({ id: sanctions.id })
      .from(sanctions)
      .where(and(
        eq(sanctions.orgId, orgId),
        gte(sanctions.createdAt, new Date(weekBounds.start)),
        lte(sanctions.createdAt, new Date(weekBounds.end)),
      )),

    // Incidents opened this week
    db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(
        eq(incidents.orgId, orgId),
        gte(incidents.createdAt, new Date(weekBounds.start)),
        lte(incidents.createdAt, new Date(weekBounds.end)),
      )),

    // Payments received this week
    db
      .select({ id: payments.id })
      .from(payments)
      .where(and(
        eq(payments.orgId, orgId),
        gte(payments.createdAt, new Date(weekBounds.start)),
        lte(payments.createdAt, new Date(weekBounds.end)),
      )),
  ]);

  const counts: WeeklySummaryCounts = {
    tasksCompleted: tasksCompletedRows.length,
    tasksPending:   tasksPendingRows.length,
    sanctions:      sanctionRows.length,
    incidents:      incidentRows.length,
    payments:       paymentRows.length,
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
