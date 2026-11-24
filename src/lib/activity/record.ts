import { db } from '@/lib/db';
import { activityEvents } from '@/lib/db/schema';
import { log } from '@/lib/log';
import type { ActivityAction } from './actions';

type ActivityInput = {
  orgId: string;
  actorId: string;
  action: ActivityAction;
  resourceType: string;
  resourceId?: string;
  summary?: string;
};

const SUMMARY_MAX = 200;

export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      ...input,
      resourceId: input.resourceId ?? null,
      summary: input.summary?.slice(0, SUMMARY_MAX) ?? null,
    });
  } catch (e) {
    log.warn('[recordActivity] insert failed', { action: input.action, error: e instanceof Error ? e.message : 'unknown' });
  }
}
