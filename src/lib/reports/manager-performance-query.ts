import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { incidents, profiles } from '@/lib/db/schema';
import { summarizeManagerPerformance, type PeriodDays } from './manager-performance';

const DAY_MS = 86_400_000;

export async function loadManagerPerformance(orgId: string, days: PeriodDays, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const isSolved = sql`${incidents.status} = 'solved'`;
  const isTimed = sql`${incidents.status} = 'solved' AND ${incidents.resolvedAt} IS NOT NULL`;

  const rows = await db
    .select({
      profileId: profiles.id,
      name: sql<string>`coalesce(${profiles.fullName}, ${profiles.email}, '')`,
      assigned: sql<number>`count(${incidents.id})`,
      resolved: sql<number>`sum(CASE WHEN ${isSolved} THEN 1 ELSE 0 END)`,
      timedResolved: sql<number>`sum(CASE WHEN ${isTimed} THEN 1 ELSE 0 END)`,
      resolutionDaysSum: sql<number>`coalesce(sum(CASE WHEN ${isTimed} THEN (${incidents.resolvedAt} - ${incidents.createdAt}) * 1.0 / ${DAY_MS} ELSE 0 END), 0)`,
    })
    .from(profiles)
    .leftJoin(incidents, and(
      eq(incidents.assignedTo, profiles.id),
      eq(incidents.orgId, orgId),
      gte(incidents.createdAt, since),
    ))
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .groupBy(profiles.id, profiles.fullName, profiles.email);

  return summarizeManagerPerformance(rows.map((row) => ({
    profileId: row.profileId,
    name: row.name,
    assigned: Number(row.assigned),
    resolved: Number(row.resolved ?? 0),
    timedResolved: Number(row.timedResolved ?? 0),
    resolutionDaysSum: Number(row.resolutionDaysSum ?? 0),
  })));
}
