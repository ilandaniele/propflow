import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { activityEvents } from '@/lib/db/schema';
import type { ActivityRange } from './filters';

const FEED_LIMIT = 100;

export async function listActivity(orgId: string, range: ActivityRange = {}) {
  return db
    .select({
      id:        activityEvents.id,
      action:    activityEvents.action,
      summary:   activityEvents.summary,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.orgId, orgId),
      range.from ? gte(activityEvents.createdAt, range.from) : undefined,
      range.to ? lt(activityEvents.createdAt, range.to) : undefined,
    ))
    .orderBy(desc(activityEvents.createdAt))
    .limit(FEED_LIMIT);
}
