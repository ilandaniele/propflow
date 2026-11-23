import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { periodCloses, profiles } from '@/lib/db/schema';
import { periodsOf } from './schemas';

export async function findClosedPeriod(orgId: string, dates: Array<string | null | undefined>): Promise<string | null> {
  const periods = periodsOf(dates);
  if (periods.length === 0) return null;
  const rows = await db
    .select({ period: periodCloses.period })
    .from(periodCloses)
    .where(and(eq(periodCloses.orgId, orgId), inArray(periodCloses.period, periods)))
    .limit(1);
  return rows[0]?.period ?? null;
}

export async function listPeriodCloses(orgId: string) {
  return db
    .select({
      period: periodCloses.period,
      note: periodCloses.note,
      closedAt: periodCloses.closedAt,
      closedByName: profiles.fullName,
    })
    .from(periodCloses)
    .leftJoin(profiles, eq(profiles.id, periodCloses.closedBy))
    .where(eq(periodCloses.orgId, orgId))
    .orderBy(desc(periodCloses.period))
    .limit(120);
}

export async function insertPeriodClose(input: { orgId: string; period: string; closedBy: string; note?: string }) {
  await db.insert(periodCloses).values({ orgId: input.orgId, period: input.period, closedBy: input.closedBy, note: input.note ?? null });
}

export async function removePeriodClose(orgId: string, period: string): Promise<boolean> {
  const removed = await db
    .delete(periodCloses)
    .where(and(eq(periodCloses.orgId, orgId), eq(periodCloses.period, period)))
    .returning({ period: periodCloses.period });
  return removed.length > 0;
}
