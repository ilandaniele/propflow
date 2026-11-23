import { db } from '@/lib/db';
import { incidentSchedules } from '@/lib/db/schema';

export async function saveIncidentSchedule(orgId: string, incidentId: string, estimatedOn: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(incidentSchedules)
    .values({ orgId, incidentId, estimatedOn, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: incidentSchedules.incidentId, set: { estimatedOn, updatedAt: now } });
}
