/**
 * Weekly property summary builder.
 * Queries this ISO week's counts for tasks, payments, incidents, and sanctions.
 * Used by the /api/cron/weekly-summary route.
 *
 * Security: No PII in returned body string. Phone numbers, tenant names, etc. are excluded.
 *
 * Migrated from Supabase admin client to Drizzle ORM (W6).
 */

import { db } from '@/lib/db';
import { properties, tenantTasks, sanctions, incidents, payments } from '@/lib/db/schema';
import { eq, and, gte, lte, count } from 'drizzle-orm';
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
 */
export async function buildWeeklySummary(
  orgId: string,
  propertyId: string
): Promise<WeeklySummaryResult> {
  const isoWeek = getIsoWeek(new Date());
  const weekBounds = getIsoWeekBounds(new Date());

  // Get property name
  const propRows = await db
    .select({ name: properties.name })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.orgId, orgId)))
    .limit(1);

  const propertyName = propRows[0]?.name ?? propertyId;

  // Tasks completed this week
  const [tcRow] = await db
    .select({ n: count() })
    .from(tenantTasks)
    .where(and(
      eq(tenantTasks.orgId, orgId),
      eq(tenantTasks.status, 'completed'),
      gte(tenantTasks.updatedAt, weekBounds.start),
      lte(tenantTasks.updatedAt, weekBounds.end),
    ));

  // Tasks still pending
  const [tpRow] = await db
    .select({ n: count() })
    .from(tenantTasks)
    .where(and(
      eq(tenantTasks.orgId, orgId),
      eq(tenantTasks.status, 'pending'),
    ));

  // Sanctions applied this week
  const [sRow] = await db
    .select({ n: count() })
    .from(sanctions)
    .where(and(
      eq(sanctions.orgId, orgId),
      gte(sanctions.createdAt, weekBounds.start),
      lte(sanctions.createdAt, weekBounds.end),
    ));

  // Incidents opened this week
  const [iRow] = await db
    .select({ n: count() })
    .from(incidents)
    .where(and(
      eq(incidents.orgId, orgId),
      gte(incidents.createdAt, weekBounds.start),
      lte(incidents.createdAt, weekBounds.end),
    ));

  // Payments received this week
  const [pRow] = await db
    .select({ n: count() })
    .from(payments)
    .where(and(
      eq(payments.orgId, orgId),
      gte(payments.createdAt, weekBounds.start),
      lte(payments.createdAt, weekBounds.end),
    ));

  const counts: WeeklySummaryCounts = {
    tasksCompleted: Number(tcRow?.n ?? 0),
    tasksPending:   Number(tpRow?.n ?? 0),
    sanctions:      Number(sRow?.n  ?? 0),
    incidents:      Number(iRow?.n  ?? 0),
    payments:       Number(pRow?.n  ?? 0),
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
  const day  = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Returns UTC start (Monday 00:00) and end (Sunday 23:59:59) of the ISO week. */
function getIsoWeekBounds(date: Date): { start: Date; end: Date } {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}
