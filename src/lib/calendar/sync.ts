/**
 * Pulls Google-side changes (deletions, moves) back into property_visits via
 * incremental sync tokens, then reconciles any visit that drifted out of
 * sync with Google in the other direction. Self-schedules its own next run;
 * ensureCalendarSyncJobs is only the safety net for a run that never fired.
 */

import { db } from '@/lib/db';
import { agentJobs, calendarConnections, notificationInbox, propertyVisits } from '@/lib/db/schema';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { log } from '@/lib/log';
import { enqueueJob } from '@/lib/agent/jobs';
import { rescheduleVisit } from '@/lib/agent/visits/service';
import { ACTIVE_VISIT_STATUSES } from '@/lib/agent/visits/types';
import { type GoogleEventItem, listEventsPage } from './google/events';
import { enqueueVisitPush } from './push';
import { CALENDAR_JOB_KINDS, GoogleApiError } from './types';

const ACTIVE_STATUSES: string[] = [...ACTIVE_VISIT_STATUSES];
const MAX_PAGES_PER_RUN = 20;
const RECONCILE_CAP = 50;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DRIFT_TOLERANCE_MS = 60_000;

// ─── classifyRemoteChange (pure) ────────────────────────────────────────────

export function classifyRemoteChange(
  v: { status: string; startsAt: Date; endsAt: Date; googleEventId: string | null },
  e: { status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } },
): 'none' | 'deleted' | 'moved' {
  if (e.status === 'cancelled') return 'deleted';
  if (!e.start?.dateTime || !e.end?.dateTime) return 'none';

  const eStart = new Date(e.start.dateTime).getTime();
  const eEnd = new Date(e.end.dateTime).getTime();
  if (Number.isNaN(eStart) || Number.isNaN(eEnd)) return 'none';

  const moved =
    Math.abs(eStart - v.startsAt.getTime()) > DRIFT_TOLERANCE_MS || Math.abs(eEnd - v.endsAt.getTime()) > DRIFT_TOLERANCE_MS;
  return moved ? 'moved' : 'none';
}

// ─── syncCalendarConnection (job handler) ───────────────────────────────────

export async function syncCalendarConnection(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const connectionId = typeof payload.connectionId === 'string' ? payload.connectionId : '';
  if (!connectionId) return;

  const rows = await db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.orgId, orgId)))
    .limit(1);
  const connection = rows[0];
  if (!connection || connection.status !== 'active') return;

  try {
    let syncToken = connection.syncToken;
    let pageToken = connection.syncPageToken;
    let pages = 0;

    while (pages < MAX_PAGES_PER_RUN) {
      pages++;
      let page;
      try {
        // No syncToken yet -> this page belongs to an initial (or post-410) full sync;
        // bound it to the last 30 days so we don't walk the calendar's entire history.
        // timeMin is dropped the moment a syncToken exists — Google rejects the combination.
        const timeMin = syncToken ? undefined : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        page = await listEventsPage(connection.id, connection.calendarId, { syncToken, pageToken, timeMin });
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 410) {
          // fullSyncRequired — clear both tokens and restart from scratch.
          syncToken = null;
          pageToken = null;
          pages = 0;
          await db
            .update(calendarConnections)
            .set({ syncToken: null, syncPageToken: null, lastFullSyncAt: new Date() })
            .where(eq(calendarConnections.id, connection.id));
          continue;
        }
        throw e;
      }

      for (const item of page.items) {
        await processRemoteEvent(orgId, connection.id, connection.profileId, item);
      }

      if (!page.nextPageToken) {
        await db
          .update(calendarConnections)
          .set({ syncToken: page.nextSyncToken ?? syncToken, syncPageToken: null, lastSyncedAt: new Date() })
          .where(eq(calendarConnections.id, connection.id));
        break;
      }

      pageToken = page.nextPageToken;
      await db.update(calendarConnections).set({ syncPageToken: pageToken }).where(eq(calendarConnections.id, connection.id));
    }

    await reconcileStaleVisits(orgId, connection.id, connection.profileId);
  } finally {
    // Self-schedule the next run — ensureCalendarSyncJobs is only the safety net.
    // Deduped: resyncCalendarNow and reconnecting the same connection can race this.
    await enqueueCalendarSyncOnce(orgId, connection.id, new Date(Date.now() + SYNC_INTERVAL_MS));
  }
}

async function processRemoteEvent(orgId: string, connectionId: string, connectionProfileId: string, item: GoogleEventItem): Promise<void> {
  const priv = item.extendedProperties?.private;
  if (!priv || priv.pfOrgId !== orgId || !priv.pfVisitId) return;

  const visitRows = await db
    .select()
    .from(propertyVisits)
    .where(and(eq(propertyVisits.id, priv.pfVisitId), eq(propertyVisits.orgId, orgId), eq(propertyVisits.profileId, connectionProfileId)))
    .limit(1);
  const visit = visitRows[0];
  if (!visit || !ACTIVE_STATUSES.includes(visit.status)) return;
  // Google duplicates copy extendedProperties onto the copy, so pfVisitId alone can
  // match a stale/duplicate event — only trust it once it's also the visit's own event.
  if (item.id !== visit.googleEventId) return;

  const change = classifyRemoteChange(
    { status: visit.status, startsAt: visit.startsAt, endsAt: visit.endsAt, googleEventId: visit.googleEventId },
    item,
  );
  if (change === 'none') return;

  if (change === 'deleted') {
    await db
      .update(propertyVisits)
      .set({ googleSyncStatus: 'detached', updatedAt: new Date() })
      .where(eq(propertyVisits.id, visit.id));
    await db.insert(notificationInbox).values({
      orgId,
      profileId: connectionProfileId,
      type: 'calendar_event_deleted',
      title: 'Evento de Google eliminado',
      body: 'Se eliminó en Google el evento de una visita agendada. Revísala en PropFlow.',
      relatedType: 'property_visit',
      relatedId: visit.id,
    });
    log.info('[calendar/sync] visit detached (deleted in Google)', { orgId, visitId: visit.id });
    return;
  }

  // 'moved'
  const start = new Date(item.start!.dateTime!);
  const end = new Date(item.end!.dateTime!);
  await db
    .update(propertyVisits)
    .set({ googleSyncStatus: 'drift', googleDriftStartsAt: start, googleDriftEndsAt: end, updatedAt: new Date() })
    .where(eq(propertyVisits.id, visit.id));
  await db.insert(notificationInbox).values({
    orgId,
    profileId: connectionProfileId,
    type: 'calendar_event_moved',
    title: 'Evento de Google movido',
    body: 'Se movió en Google el horario de una visita agendada. Resuelve el conflicto en PropFlow.',
    relatedType: 'property_visit',
    relatedId: visit.id,
  });
  log.info('[calendar/sync] visit drift detected (moved in Google)', { orgId, visitId: visit.id });
}

async function reconcileStaleVisits(orgId: string, connectionId: string, profileId: string): Promise<void> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleRows = await db
    .select({ id: propertyVisits.id })
    .from(propertyVisits)
    .where(and(
      eq(propertyVisits.orgId, orgId),
      eq(propertyVisits.profileId, profileId),
      gt(propertyVisits.startsAt, dayAgo),
      or(
        inArray(propertyVisits.googleSyncStatus, ['pending', 'error']),
        and(inArray(propertyVisits.status, ACTIVE_STATUSES), sql`${propertyVisits.updatedAt} > ${propertyVisits.googleSyncedAt}`),
        and(inArray(propertyVisits.status, ACTIVE_STATUSES), isNull(propertyVisits.googleEventId)),
      ),
    ))
    .limit(RECONCILE_CAP);

  for (const row of staleRows) {
    await enqueueVisitPush(orgId, row.id, profileId);
  }
}

/**
 * Enqueues a single calendar.sync job for connectionId, unless one is already
 * pending/processing for it. Shared by every call site that can enqueue a
 * sync for the same connection concurrently — this file's own self-schedule,
 * resyncCalendarNow, and reconnecting (saveConnection) — so those chains
 * never fan out into duplicate jobs. Returns whether a job was enqueued.
 */
export async function enqueueCalendarSyncOnce(orgId: string, connectionId: string, runAt?: Date): Promise<boolean> {
  const pending = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(
      eq(agentJobs.kind, CALENDAR_JOB_KINDS.sync),
      inArray(agentJobs.status, ['pending', 'processing']),
      sql`${agentJobs.payload} ->> 'connectionId' = ${connectionId}`,
    ))
    .limit(1);
  if (pending.length > 0) return false;

  await enqueueJob({ orgId, kind: CALENDAR_JOB_KINDS.sync, payload: { connectionId }, ...(runAt ? { runAt } : {}) });
  return true;
}

/** Active connections that haven't synced in >5min and have no pending/processing calendar.sync job already queued -> enqueue one. Returns the count enqueued. */
export async function ensureCalendarSyncJobs(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - SYNC_INTERVAL_MS);

  const staleConnections = await db
    .select({ id: calendarConnections.id, orgId: calendarConnections.orgId })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.status, 'active'),
      or(isNull(calendarConnections.lastSyncedAt), lt(calendarConnections.lastSyncedAt, threshold)),
    ));

  let enqueued = 0;
  for (const conn of staleConnections) {
    if (await enqueueCalendarSyncOnce(conn.orgId, conn.id)) enqueued++;
  }
  return enqueued;
}

// ─── resolveVisitDrift ───────────────────────────────────────────────────────

export async function resolveVisitDrift(
  a: { orgId: string; visitId: string; keep: 'propflow' | 'google'; actorProfileId: string },
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_drift' | 'slot_taken' | 'not_active' }> {
  const rows = await db.select().from(propertyVisits).where(and(eq(propertyVisits.id, a.visitId), eq(propertyVisits.orgId, a.orgId))).limit(1);
  const visit = rows[0];
  if (!visit) return { ok: false, reason: 'not_found' };
  if (visit.googleSyncStatus !== 'drift') return { ok: false, reason: 'not_drift' };
  if (!ACTIVE_STATUSES.includes(visit.status)) return { ok: false, reason: 'not_active' };

  if (a.keep === 'propflow') {
    await db
      .update(propertyVisits)
      .set({ googleDriftStartsAt: null, googleDriftEndsAt: null, updatedAt: new Date() })
      .where(eq(propertyVisits.id, visit.id));
    await enqueueJob({ orgId: a.orgId, kind: CALENDAR_JOB_KINDS.push, payload: { visitId: visit.id, force: true } });
    return { ok: true };
  }

  // keep === 'google'
  if (!visit.googleDriftStartsAt || !visit.googleDriftEndsAt) return { ok: false, reason: 'not_drift' };
  const visitMinutes = Math.round((visit.googleDriftEndsAt.getTime() - visit.googleDriftStartsAt.getTime()) / 60_000);

  const result = await rescheduleVisit({
    orgId: a.orgId,
    visitId: visit.id,
    leadId: null,
    newStartsAt: visit.googleDriftStartsAt,
    visitMinutes,
    actor: 'human',
    actorProfileId: a.actorProfileId,
  });
  if (!result.ok) {
    if (result.reason === 'slot_taken') return { ok: false, reason: 'slot_taken' };
    return { ok: false, reason: 'not_active' };
  }
  return { ok: true };
}
