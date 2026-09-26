/**
 * One visit -> one Google Calendar event, in both directions. Desired state
 * is always derived from the current property_visits row (never from the
 * job payload beyond visitId/force), which makes pushVisitToCalendar
 * idempotent and safe to run against a stale/duplicated job.
 */

import { db } from '@/lib/db';
import { crmLeads, listings, profiles, propertyVisits } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { env } from '@/lib/env';
import type { VisitRecord } from '@/lib/agent/visits/types';
import { buildVisitEvent, deleteEvent, eventIdForVisit, insertEvent, patchEvent } from './google/events';
import { getConnectionForProfile } from './connections';
import { CALENDAR_JOB_KINDS, CalendarAuthError, GoogleApiError } from './types';
import { enqueueJob } from '@/lib/agent/jobs';

const WRITE_STATUSES = ['scheduled', 'confirmed', 'completed', 'no_show'];
const DETACH_STATUSES = ['cancelled', 'rescheduled'];

/** Sets google_sync_status='pending' and enqueues the push job — only if the profile has an active connection with write_events on. */
export async function enqueueVisitPush(orgId: string, visitId: string, profileId: string): Promise<boolean> {
  const connection = await getConnectionForProfile(orgId, profileId);
  if (!connection || connection.status !== 'active' || !connection.writeEvents) return false;

  await db
    .update(propertyVisits)
    .set({ googleSyncStatus: 'pending', updatedAt: new Date() })
    .where(and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId)));

  await enqueueJob({ orgId, kind: CALENDAR_JOB_KINDS.push, payload: { visitId } });
  return true;
}

export async function pushVisitToCalendar(payload: Record<string, unknown>, orgId: string): Promise<void> {
  const visitId = typeof payload.visitId === 'string' ? payload.visitId : '';
  if (!visitId) return;
  const force = payload.force === true;

  const rows = await db
    .select({
      visit: propertyVisits,
      listingTitle: listings.title,
      advisorName: profiles.fullName,
      leadName: crmLeads.fullName,
    })
    .from(propertyVisits)
    .leftJoin(listings, eq(listings.id, propertyVisits.listingId))
    .leftJoin(profiles, eq(profiles.id, propertyVisits.profileId))
    .leftJoin(crmLeads, eq(crmLeads.id, propertyVisits.leadId))
    .where(and(eq(propertyVisits.id, visitId), eq(propertyVisits.orgId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) return; // stale job — visit no longer exists

  const visit = row.visit;
  // Drift is a human decision (resolveCalendarDrift) — left alone unless the caller forces it.
  if (visit.googleSyncStatus === 'drift' && !force) return;

  const connection = await getConnectionForProfile(orgId, visit.profileId);
  if (!connection || connection.status !== 'active' || !connection.writeEvents) return;

  const now = new Date();

  try {
    if (WRITE_STATUSES.includes(visit.status)) {
      const config = await getOrCreateAgentConfig(orgId);
      const visitRecord: VisitRecord = {
        id: visit.id,
        orgId: visit.orgId,
        leadId: visit.leadId,
        listingId: visit.listingId,
        profileId: visit.profileId,
        sessionId: visit.sessionId,
        contactPhone: visit.contactPhone,
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        blockedUntil: visit.blockedUntil,
        status: visit.status as VisitRecord['status'],
        createdBy: visit.createdBy as 'agent' | 'human',
        sourceChannel: visit.sourceChannel as VisitRecord['sourceChannel'],
        rescheduledFromId: visit.rescheduledFromId,
        feedback: visit.feedback as VisitRecord['feedback'],
        notes: visit.notes,
        listingTitle: row.listingTitle,
        advisorName: row.advisorName,
        leadName: row.leadName,
      };

      const body = buildVisitEvent(visitRecord, {
        timeZone: config.timezone,
        dashboardUrl: env.NEXT_PUBLIC_SITE_URL,
        includeId: !visit.googleEventId,
      });

      let result: { id: string; etag: string };
      if (visit.googleEventId) {
        try {
          result = await patchEvent(connection.id, connection.calendarId, visit.googleEventId, body);
        } catch (e) {
          if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) {
            // The event is gone on Google's side (deleted out from under us) — recreate it
            // instead of erroring forever on every retry.
            result = await insertEvent(connection.id, connection.calendarId, { ...body, id: eventIdForVisit(visit.id) });
          } else {
            throw e;
          }
        }
      } else {
        result = await insertEvent(connection.id, connection.calendarId, body);
      }

      await db
        .update(propertyVisits)
        .set({
          googleEventId: result.id,
          googleEventEtag: result.etag,
          googleConnectionId: connection.id,
          googleSyncStatus: 'synced',
          googleSyncedAt: now,
          googleSyncError: null,
          updatedAt: now,
        })
        .where(eq(propertyVisits.id, visitId));
    } else if (DETACH_STATUSES.includes(visit.status)) {
      if (visit.googleEventId) await deleteEvent(connection.id, connection.calendarId, visit.googleEventId);
      await db
        .update(propertyVisits)
        .set({ googleSyncStatus: 'detached', googleEventId: null, googleSyncedAt: now, updatedAt: now })
        .where(eq(propertyVisits.id, visitId));
    }
  } catch (e) {
    // The connection is already marked 'revoked' by getValidAccessToken — no further bookkeeping needed here.
    if (e instanceof CalendarAuthError) return;

    if (e instanceof GoogleApiError) {
      if (e.status >= 500 || e.status === 429) throw e; // transient — let the job retry
      await db
        .update(propertyVisits)
        .set({ googleSyncStatus: 'error', googleSyncError: e.reason ?? String(e.status), updatedAt: new Date() })
        .where(eq(propertyVisits.id, visitId));
      return;
    }

    throw e;
  }
}
