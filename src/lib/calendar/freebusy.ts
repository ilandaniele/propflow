/**
 * FreeBusy busy-interval provider registered into
 * src/lib/agent/visits/availability.ts's provider registry (dynamic import
 * there avoids a circular-init/TDZ problem — see registerGoogleFreeBusyProvider
 * below). Per-advisor failure isolation: a Google error for one advisor's
 * connection fail-closes only that advisor (blueprint assumption 7); other
 * advisors are still offered.
 *
 * Only busy intervals are read here — event details (titles, attendees,
 * descriptions) are never fetched.
 */

import { log } from '@/lib/log';
import type { BusyIntervalProvider } from '@/lib/agent/visits/availability';
import { registerBusyIntervalProvider } from '@/lib/agent/visits/availability';
import type { Interval } from '@/lib/agent/visits/types';
import { googleFetch } from './google/client';
import { listConnections } from './connections';
import { CalendarAuthError } from './types';
import type { CalendarConnection } from './types';

const CACHE_TTL_MS = 60_000;
const FREEBUSY_TIMEOUT_MS = 3000;

interface CacheEntry {
  expiresAt: number;
  intervals: Interval[];
}

const cache = new Map<string, CacheEntry>();

/** Test-only. */
export function clearFreeBusyCache(): void {
  cache.clear();
}

interface FreeBusyResponse {
  calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>;
}

async function fetchBusyForConnection(conn: CalendarConnection, from: Date, to: Date): Promise<Interval[]> {
  const cacheKey = `${conn.id}|${from.toISOString()}|${to.toISOString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.intervals;

  try {
    const res = await googleFetch<FreeBusyResponse>(conn.id, '/freeBusy', {
      method: 'POST',
      timeoutMs: FREEBUSY_TIMEOUT_MS,
      body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: conn.calendarId }] },
    });
    const calendarErrors = res.calendars?.[conn.calendarId]?.errors;
    if (calendarErrors && calendarErrors.length > 0) {
      // A 200 with a per-calendar error (e.g. notFound) is still a failure for this calendar —
      // fail-closed the same as a transport/HTTP error, not fail-open as an empty busy list.
      log.warn('[calendar/freebusy] google freeBusy reported a per-calendar error, blocking full range for this advisor', {
        connectionId: conn.id,
        reason: calendarErrors[0]?.reason ?? null,
      });
      const blockedOnError: Interval[] = [{ start: from, end: to }];
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, intervals: blockedOnError });
      return blockedOnError;
    }
    const busy = (res.calendars?.[conn.calendarId]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, intervals: busy });
    return busy;
  } catch (e) {
    if (e instanceof CalendarAuthError) {
      // Revoked — already marked by getValidAccessToken. Treated as not
      // connected (fail-open): this advisor is simply omitted below.
      return [];
    }
    log.warn('[calendar/freebusy] google freebusy call failed, blocking full range for this advisor', {
      connectionId: conn.id,
      error: (e as Error).message,
    });
    const blocked: Interval[] = [{ start: from, end: to }];
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, intervals: blocked });
    return blocked;
  }
}

export const googleFreeBusyProvider: BusyIntervalProvider = async ({ orgId, profileIds, from, to }) => {
  const result = new Map<string, Interval[]>();
  if (profileIds.length === 0) return result;

  const connections = await listConnections(orgId);
  const eligible = connections.filter(
    (c) => profileIds.includes(c.profileId) && c.status === 'active' && c.freebusyEnabled,
  );

  await Promise.all(
    eligible.map(async (conn) => {
      const intervals = await fetchBusyForConnection(conn, from, to);
      if (intervals.length > 0) result.set(conn.profileId, intervals);
    }),
  );

  return result;
};

let registered = false;

/** Idempotent — safe to call from every bundle (instrumentation, routes) via availability.ts's lazy dynamic import. */
export function registerGoogleFreeBusyProvider(): void {
  if (registered) return;
  registered = true;
  registerBusyIntervalProvider('google-freebusy', googleFreeBusyProvider);
}
