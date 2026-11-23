import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dayInZone } from './dates';

export const CALENDAR_EVENT_KINDS = ['contract_start', 'contract_end', 'charge_due', 'cleaning', 'visit'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export interface CalendarEvent {
  kind: CalendarEventKind;
  refId: string;
  day: string;
  startAt: number | null;
  endAt: number | null;
  label: string | null;
  detail: string | null;
  count: number;
}

const DAY_MS = 86_400_000;

export async function listCalendarEvents(orgId: string, from: string, to: string): Promise<CalendarEvent[]> {
  const fromMs = Date.parse(`${from}T00:00:00Z`) - DAY_MS;
  const toMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;

  const rows = await db.all<CalendarEvent>(sql`
    SELECT 'contract_start' AS kind, c.id AS refId, c.start_date AS day, NULL AS startAt, NULL AS endAt,
      t.full_name AS label, u.label AS detail, 1 AS count
    FROM contracts c JOIN tenants t ON t.id = c.tenant_id JOIN units u ON u.id = c.unit_id
    WHERE c.org_id = ${orgId} AND c.status = 'active' AND c.start_date >= ${from} AND c.start_date < ${to}
    UNION ALL
    SELECT 'contract_end', c.id, c.end_date, NULL, NULL, t.full_name, u.label, 1
    FROM contracts c JOIN tenants t ON t.id = c.tenant_id JOIN units u ON u.id = c.unit_id
    WHERE c.org_id = ${orgId} AND c.status = 'active' AND c.end_date >= ${from} AND c.end_date < ${to}
    UNION ALL
    SELECT 'charge_due', due_date, due_date, NULL, NULL, NULL, NULL, COUNT(*)
    FROM charges WHERE org_id = ${orgId} AND due_date >= ${from} AND due_date < ${to}
    GROUP BY due_date
    UNION ALL
    SELECT 'cleaning', ct.id, ct.scheduled_date, NULL, NULL, ct.title, u.label, 1
    FROM cleaning_tasks ct LEFT JOIN units u ON u.id = ct.unit_id
    WHERE ct.org_id = ${orgId} AND ct.status <> 'done' AND ct.scheduled_date >= ${from} AND ct.scheduled_date < ${to}
    UNION ALL
    SELECT 'visit', v.id, NULL, v.starts_at, v.ends_at, l.full_name, NULL, 1
    FROM property_visits v JOIN crm_leads l ON l.id = v.lead_id
    WHERE v.org_id = ${orgId} AND v.status IN ('scheduled', 'confirmed') AND v.starts_at >= ${fromMs} AND v.starts_at < ${toMs}
  `);

  return rows
    .map((r) => {
      const startAt = r.startAt === null ? null : Number(r.startAt);
      return {
        ...r,
        startAt,
        endAt: r.endAt === null ? null : Number(r.endAt),
        count: Number(r.count),
        day: startAt === null ? r.day : dayInZone(startAt),
      };
    })
    .filter((e) => e.day >= from && e.day < to)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.startAt ?? 0) - (b.startAt ?? 0));
}

export function groupByDay(events: CalendarEvent[]): Array<{ day: string; events: CalendarEvent[] }> {
  const days = new Map<string, CalendarEvent[]>();
  for (const event of events) days.set(event.day, [...(days.get(event.day) ?? []), event]);
  return [...days].map(([day, list]) => ({ day, events: list }));
}
