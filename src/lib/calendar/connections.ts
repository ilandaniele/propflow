/**
 * calendar_connections CRUD + the encrypted-token access-token cache
 * (getValidAccessToken). One connection per (org, advisor profile) —
 * enforced by the DB's unique index, upserted on here.
 *
 * Tokens are AES-256-GCM ciphertext at rest (src/lib/crypto/encrypt.ts) and
 * are never returned to callers in plaintext except getValidAccessToken's
 * short-lived access token, which google/client.ts uses immediately and
 * never logs.
 */

import { db } from '@/lib/db';
import { calendarConnections, notificationInbox, profiles, propertyVisits } from '@/lib/db/schema';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { decrypt, encrypt } from '@/lib/crypto/encrypt';
import { log } from '@/lib/log';
import { enqueueJob } from '@/lib/agent/jobs';
import { ACTIVE_VISIT_STATUSES } from '@/lib/agent/visits/types';
import { refreshAccessToken, revokeToken } from './google/oauth';
import { CALENDAR_JOB_KINDS } from './types';
import { CalendarAuthError, type CalendarConnection } from './types';

const ACCESS_TOKEN_MIN_REMAINING_MS = 60_000;

function toConnection(row: typeof calendarConnections.$inferSelect): CalendarConnection {
  return {
    id: row.id,
    orgId: row.orgId,
    profileId: row.profileId,
    googleEmail: row.googleEmail,
    calendarId: row.calendarId,
    status: row.status as CalendarConnection['status'],
    freebusyEnabled: row.freebusyEnabled,
    writeEvents: row.writeEvents,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
  };
}

export async function getConnectionForProfile(orgId: string, profileId: string): Promise<CalendarConnection | null> {
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.orgId, orgId), eq(calendarConnections.profileId, profileId)))
    .limit(1);
  return rows[0] ? toConnection(rows[0]) : null;
}

export async function listConnections(orgId: string): Promise<Array<CalendarConnection & { profileName: string | null }>> {
  const rows = await db
    .select({ connection: calendarConnections, profileName: profiles.fullName })
    .from(calendarConnections)
    .leftJoin(profiles, eq(profiles.id, calendarConnections.profileId))
    .where(eq(calendarConnections.orgId, orgId));

  return rows.map((r) => ({ ...toConnection(r.connection), profileName: r.profileName }));
}

export interface SaveConnectionArgs {
  orgId: string;
  profileId: string;
  googleEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
}

/** Upsert on (org_id, profile_id) — reconnecting an existing advisor replaces their tokens rather than erroring. Backfills a calendar.sync now and a calendar.push_visit for every active future visit of the profile. */
export async function saveConnection(a: SaveConnectionArgs): Promise<CalendarConnection> {
  const refreshTokenEnc = encrypt(a.refreshToken);
  const accessTokenEnc = encrypt(a.accessToken);

  const rows = await db
    .insert(calendarConnections)
    .values({
      orgId: a.orgId,
      profileId: a.profileId,
      googleEmail: a.googleEmail,
      scopes: a.scopes,
      refreshTokenEnc,
      accessTokenEnc,
      accessTokenExpiresAt: a.expiresAt,
      status: 'active',
      lastError: null,
      syncToken: null,
      syncPageToken: null,
    })
    .onConflictDoUpdate({
      target: [calendarConnections.orgId, calendarConnections.profileId],
      set: {
        googleEmail: a.googleEmail,
        scopes: a.scopes,
        refreshTokenEnc,
        accessTokenEnc,
        accessTokenExpiresAt: a.expiresAt,
        status: 'active',
        lastError: null,
        syncToken: null,
        syncPageToken: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];

  await enqueueJob({ orgId: a.orgId, kind: CALENDAR_JOB_KINDS.sync, payload: { connectionId: row.id } });

  const now = new Date();
  const activeVisits = await db
    .select({ id: propertyVisits.id })
    .from(propertyVisits)
    .where(and(
      eq(propertyVisits.orgId, a.orgId),
      eq(propertyVisits.profileId, a.profileId),
      inArray(propertyVisits.status, ACTIVE_VISIT_STATUSES as unknown as string[]),
      gte(propertyVisits.startsAt, now),
    ));
  for (const v of activeVisits) {
    await db.update(propertyVisits).set({ googleSyncStatus: 'pending', updatedAt: now }).where(eq(propertyVisits.id, v.id));
    await enqueueJob({ orgId: a.orgId, kind: CALENDAR_JOB_KINDS.push, payload: { visitId: v.id } });
  }

  return toConnection(row);
}

/** Best-effort revoke + delete. Existing Google-side events are left in place (documented in the UI copy) — this only stops PropFlow from writing to them going forward. */
export async function disconnectConnection(orgId: string, profileId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.orgId, orgId), eq(calendarConnections.profileId, profileId)))
    .limit(1);
  const conn = rows[0];
  if (!conn) return false;

  try {
    await revokeToken(decrypt(conn.refreshTokenEnc));
  } catch (e) {
    log.warn('[calendar/connections] revoke failed during disconnect', { connectionId: conn.id, error: (e as Error).message });
  }

  await db.delete(calendarConnections).where(eq(calendarConnections.id, conn.id));
  await db
    .update(propertyVisits)
    .set({ googleSyncStatus: 'none', googleConnectionId: null, googleEventId: null, updatedAt: new Date() })
    .where(and(eq(propertyVisits.orgId, orgId), eq(propertyVisits.googleConnectionId, conn.id)));

  return true;
}

export async function updateConnectionSettings(
  orgId: string,
  profileId: string,
  p: { freebusyEnabled?: boolean; writeEvents?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (p.freebusyEnabled !== undefined) patch.freebusyEnabled = p.freebusyEnabled;
  if (p.writeEvents !== undefined) patch.writeEvents = p.writeEvents;
  if (Object.keys(patch).length === 1) return;

  await db
    .update(calendarConnections)
    .set(patch)
    .where(and(eq(calendarConnections.orgId, orgId), eq(calendarConnections.profileId, profileId)));
}

/**
 * Cached access token if it still has >60s left; otherwise refreshes and
 * persists the new encrypted token. A CalendarAuthError (invalid_grant)
 * marks the connection revoked and notifies the advisor before rethrowing —
 * every caller (google/client.ts's 401 retry, freebusy) sees the same error
 * without duplicating that bookkeeping.
 */
export async function getValidAccessToken(connectionId: string, opts?: { forceRefresh?: boolean }): Promise<string> {
  const rows = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)).limit(1);
  const conn = rows[0];
  if (!conn) throw new CalendarAuthError('Calendar connection not found');

  const now = Date.now();
  if (
    !opts?.forceRefresh &&
    conn.accessTokenEnc &&
    conn.accessTokenExpiresAt &&
    conn.accessTokenExpiresAt.getTime() - now > ACCESS_TOKEN_MIN_REMAINING_MS
  ) {
    return decrypt(conn.accessTokenEnc);
  }

  try {
    const refreshed = await refreshAccessToken(decrypt(conn.refreshTokenEnc));
    await db
      .update(calendarConnections)
      .set({ accessTokenEnc: encrypt(refreshed.accessToken), accessTokenExpiresAt: refreshed.expiresAt, updatedAt: new Date() })
      .where(eq(calendarConnections.id, conn.id));
    return refreshed.accessToken;
  } catch (e) {
    if (e instanceof CalendarAuthError) {
      await db
        .update(calendarConnections)
        .set({ status: 'revoked', lastError: 'invalid_grant', updatedAt: new Date() })
        .where(eq(calendarConnections.id, conn.id));
      await db.insert(notificationInbox).values({
        orgId: conn.orgId,
        profileId: conn.profileId,
        type: 'calendar_revoked',
        title: 'Conexión de Google Calendar revocada',
        body: 'Vuelve a conectar tu calendario de Google para seguir sincronizando visitas.',
        relatedType: 'calendar_connection',
        relatedId: conn.id,
      });
    }
    throw e;
  }
}

export async function markConnectionError(id: string, code: string): Promise<void> {
  await db.update(calendarConnections).set({ status: 'error', lastError: code, updatedAt: new Date() }).where(eq(calendarConnections.id, id));
}
