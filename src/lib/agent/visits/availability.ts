/**
 * Loads advisor inputs for `computeAvailableSlots` (slots.ts) from the DB,
 * plus a pluggable hook for external busy intervals (Phase 5's Google
 * free/busy). This is the only module in item A that talks to the DB.
 */

import { db } from '@/lib/db';
import {
  agentAdvisorSettings,
  agentAvailability,
  agentAvailabilityExceptions,
  listings,
  profiles,
  propertyVisits,
} from '@/lib/db/schema';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from '../config';
import { computeAvailableSlots, type AdvisorSlotInput } from './slots';
import { ACTIVE_VISIT_STATUSES, type Interval, type Slot } from './types';

export type BusyIntervalProvider = (a: {
  orgId: string;
  profileIds: string[];
  from: Date;
  to: Date;
}) => Promise<Map<string, Interval[]>>;

const PROVIDERS = new Map<string, BusyIntervalProvider>();

/** Later phases register here — e.g. Phase 5's 'google-freebusy'. */
export function registerBusyIntervalProvider(name: string, p: BusyIntervalProvider): void {
  PROVIDERS.set(name, p);
}

/** Test-only. */
export function clearBusyIntervalProviders(): void {
  PROVIDERS.clear();
}

const ACTIVE_STATUSES = ACTIVE_VISIT_STATUSES as unknown as string[];

export async function loadAdvisorSlotInputs(
  orgId: string,
  from: Date,
  to: Date,
  profileIds?: string[],
): Promise<AdvisorSlotInput[]> {
  const settingsConditions = [eq(agentAdvisorSettings.orgId, orgId), eq(agentAdvisorSettings.acceptsVisits, true)];
  if (profileIds && profileIds.length > 0) settingsConditions.push(inArray(agentAdvisorSettings.profileId, profileIds));

  const settingsRows = await db
    .select({
      profileId: agentAdvisorSettings.profileId,
      visitMinutes: agentAdvisorSettings.visitMinutes,
      bufferMinutes: agentAdvisorSettings.bufferMinutes,
      minNoticeMinutes: agentAdvisorSettings.minNoticeMinutes,
      daysAhead: agentAdvisorSettings.daysAhead,
      slotStepMinutes: agentAdvisorSettings.slotStepMinutes,
      role: profiles.role,
    })
    .from(agentAdvisorSettings)
    .innerJoin(profiles, and(eq(profiles.id, agentAdvisorSettings.profileId), eq(profiles.orgId, orgId)))
    .where(and(...settingsConditions));

  const advisors = settingsRows.filter((r) => r.role === 'admin');
  if (advisors.length === 0) return [];

  const advisorIds = advisors.map((a) => a.profileId);

  const [windowRows, exceptionRows, visitRows] = await Promise.all([
    db
      .select()
      .from(agentAvailability)
      .where(and(eq(agentAvailability.orgId, orgId), inArray(agentAvailability.profileId, advisorIds))),
    db
      .select()
      .from(agentAvailabilityExceptions)
      .where(and(
        eq(agentAvailabilityExceptions.orgId, orgId),
        inArray(agentAvailabilityExceptions.profileId, advisorIds),
        gte(agentAvailabilityExceptions.endsAt, from),
        lt(agentAvailabilityExceptions.startsAt, to),
      )),
    db
      .select({ profileId: propertyVisits.profileId, startsAt: propertyVisits.startsAt, blockedUntil: propertyVisits.blockedUntil })
      .from(propertyVisits)
      .where(and(
        eq(propertyVisits.orgId, orgId),
        inArray(propertyVisits.profileId, advisorIds),
        inArray(propertyVisits.status, ACTIVE_STATUSES),
        lt(propertyVisits.startsAt, to),
        gte(propertyVisits.blockedUntil, from),
      )),
  ]);

  // External providers (e.g. Phase 5's Google free/busy) run in parallel;
  // a failing provider is logged and ignored (fail-open — the DB EXCLUDE
  // constraint still protects internal bookings from double-booking).
  const providerResults = await Promise.all(
    Array.from(PROVIDERS.entries()).map(async ([name, provider]) => {
      try {
        return await provider({ orgId, profileIds: advisorIds, from, to });
      } catch (e) {
        log.warn('[agent/visits/availability] busy interval provider failed', { provider: name, error: (e as Error).message });
        return new Map<string, Interval[]>();
      }
    }),
  );

  return advisors.map((a) => {
    const busy: Interval[] = visitRows
      .filter((v) => v.profileId === a.profileId)
      .map((v) => ({ start: v.startsAt, end: v.blockedUntil }));

    for (const result of providerResults) {
      const extra = result.get(a.profileId);
      if (extra) busy.push(...extra);
    }

    return {
      profileId: a.profileId,
      windows: windowRows
        .filter((w) => w.profileId === a.profileId)
        .map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })),
      visitMinutes: a.visitMinutes,
      bufferMinutes: a.bufferMinutes,
      minNoticeMinutes: a.minNoticeMinutes,
      daysAhead: a.daysAhead,
      stepMinutes: a.slotStepMinutes,
      exceptions: exceptionRows
        .filter((e) => e.profileId === a.profileId)
        .map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind as 'block' | 'extra' })),
      busy,
    };
  });
}

export async function getAvailableSlotsForOrg(a: {
  orgId: string;
  listingId?: string | null;
  from?: Date;
  to?: Date;
  profileIds?: string[];
  now?: Date;
}): Promise<{ timezone: string; slots: Slot[]; loadByProfile: Record<string, number> }> {
  const config = await getOrCreateAgentConfig(a.orgId);
  const timezone = config.timezone;
  const now = a.now ?? new Date();

  if (a.listingId) {
    const rows = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, a.listingId), eq(listings.orgId, a.orgId)))
      .limit(1);
    if (!rows[0]) return { timezone, slots: [], loadByProfile: {} };
  }

  const from = a.from ?? now;
  // Generous outer bound for the DB queries — each advisor's own daysAhead
  // narrows the actual slot horizon further inside computeAvailableSlots.
  const to = a.to ?? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const advisors = await loadAdvisorSlotInputs(a.orgId, from, to, a.profileIds);
  const slots = computeAvailableSlots({ timezone, now, advisors, from: a.from, to: a.to });

  const loadByProfile: Record<string, number> = {};
  if (advisors.length > 0) {
    const advisorIds = advisors.map((x) => x.profileId);
    const visitCounts = await db
      .select({ profileId: propertyVisits.profileId })
      .from(propertyVisits)
      .where(and(
        eq(propertyVisits.orgId, a.orgId),
        inArray(propertyVisits.profileId, advisorIds),
        inArray(propertyVisits.status, ACTIVE_STATUSES),
        lt(propertyVisits.startsAt, to),
        gte(propertyVisits.blockedUntil, from),
      ));
    for (const row of visitCounts) loadByProfile[row.profileId] = (loadByProfile[row.profileId] ?? 0) + 1;
    for (const id of advisorIds) loadByProfile[id] = loadByProfile[id] ?? 0;
  }

  return { timezone, slots, loadByProfile };
}
