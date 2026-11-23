import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { incidentStatusEvents, profiles } from '@/lib/db/schema';

export function listIncidentStatusEvents(orgId: string, incidentId: string) {
  return db
    .select({
      id: incidentStatusEvents.id,
      fromStatus: incidentStatusEvents.fromStatus,
      toStatus: incidentStatusEvents.toStatus,
      createdAt: incidentStatusEvents.createdAt,
      changedByName: profiles.fullName,
    })
    .from(incidentStatusEvents)
    .leftJoin(profiles, eq(profiles.id, incidentStatusEvents.changedBy))
    .where(and(eq(incidentStatusEvents.orgId, orgId), eq(incidentStatusEvents.incidentId, incidentId)))
    .orderBy(asc(incidentStatusEvents.createdAt))
    .limit(100);
}

export type IncidentStatusEvent = Awaited<ReturnType<typeof listIncidentStatusEvents>>[number];
