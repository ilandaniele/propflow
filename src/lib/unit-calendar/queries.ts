import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, unitCalendars, unitExternalBlocks, units } from '@/lib/db/schema';
import type { CalendarEvent } from './ical';

const INSERT_CHUNK = 10;
const MAX_LISTED_BLOCKS = 100;

export type UnitCalendar = typeof unitCalendars.$inferSelect;

function newExportToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function unitBelongsToOrg(orgId: string, unitId: string): Promise<boolean> {
  const rows = await db.select({ id: units.id }).from(units).where(and(eq(units.id, unitId), eq(units.orgId, orgId))).limit(1);
  return rows.length > 0;
}

export async function getUnitCalendar(orgId: string, unitId: string): Promise<UnitCalendar | null> {
  const rows = await db
    .select()
    .from(unitCalendars)
    .where(and(eq(unitCalendars.orgId, orgId), eq(unitCalendars.unitId, unitId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUnitCalendar(orgId: string, unitId: string): Promise<void> {
  await db
    .insert(unitCalendars)
    .values({ orgId, unitId, exportToken: newExportToken() })
    .onConflictDoNothing({ target: unitCalendars.unitId });
}

export async function setUnitCalendarImportUrl(orgId: string, unitId: string, importUrl: string | null): Promise<UnitCalendar | null> {
  const rows = await db
    .update(unitCalendars)
    .set({ importUrl, lastSyncError: null, updatedAt: new Date() })
    .where(and(eq(unitCalendars.orgId, orgId), eq(unitCalendars.unitId, unitId)))
    .returning();
  return rows[0] ?? null;
}

export async function getCalendarByToken(token: string): Promise<{ orgId: string; unitId: string; unitLabel: string } | null> {
  const rows = await db
    .select({ orgId: unitCalendars.orgId, unitId: unitCalendars.unitId, unitLabel: units.label })
    .from(unitCalendars)
    .innerJoin(units, eq(units.id, unitCalendars.unitId))
    .where(eq(unitCalendars.exportToken, token))
    .limit(1);
  return rows[0] ?? null;
}

/** Active contracts of the unit that have not ended before `today`. */
export async function listUnitOccupancy(orgId: string, unitId: string, today: string) {
  return db
    .select({ id: contracts.id, startDate: contracts.startDate, endDate: contracts.endDate })
    .from(contracts)
    .where(and(
      eq(contracts.orgId, orgId),
      eq(contracts.unitId, unitId),
      eq(contracts.status, 'active'),
      or(isNull(contracts.endDate), gte(contracts.endDate, today)),
    ))
    .orderBy(asc(contracts.startDate));
}

export async function listUpcomingBlocks(orgId: string, unitId: string, today: string) {
  return db
    .select({ id: unitExternalBlocks.id, startsOn: unitExternalBlocks.startsOn, endsOn: unitExternalBlocks.endsOn, summary: unitExternalBlocks.summary })
    .from(unitExternalBlocks)
    .where(and(eq(unitExternalBlocks.orgId, orgId), eq(unitExternalBlocks.unitId, unitId), gte(unitExternalBlocks.endsOn, today)))
    .orderBy(asc(unitExternalBlocks.startsOn))
    .limit(MAX_LISTED_BLOCKS);
}

/** Calendars with an import URL never synced or last synced before `syncedBefore`, oldest first. */
export async function listDueCalendars(syncedBefore: Date, limit: number): Promise<UnitCalendar[]> {
  return db
    .select()
    .from(unitCalendars)
    .where(and(isNotNull(unitCalendars.importUrl), or(isNull(unitCalendars.lastSyncedAt), lt(unitCalendars.lastSyncedAt, syncedBefore))))
    .orderBy(sql`${unitCalendars.lastSyncedAt} IS NOT NULL`, asc(unitCalendars.lastSyncedAt))
    .limit(limit);
}

/** Swaps the calendar's blocks for `events` and stamps the sync, in one D1 batch. */
export async function replaceExternalBlocks(calendar: UnitCalendar, events: CalendarEvent[], now: Date): Promise<void> {
  const rows = events.map((e) => ({ ...e, orgId: calendar.orgId, unitId: calendar.unitId, calendarId: calendar.id }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    inserts.push(db.insert(unitExternalBlocks).values(rows.slice(i, i + INSERT_CHUNK)));
  }
  await db.batch([
    db.delete(unitExternalBlocks).where(eq(unitExternalBlocks.calendarId, calendar.id)),
    ...inserts,
    db.update(unitCalendars).set({ lastSyncedAt: now, lastSyncError: null, updatedAt: now }).where(eq(unitCalendars.id, calendar.id)),
  ]);
}

export async function recordSyncError(calendarId: string, message: string, now: Date): Promise<void> {
  await db
    .update(unitCalendars)
    .set({ lastSyncedAt: now, lastSyncError: message.slice(0, 300), updatedAt: now })
    .where(eq(unitCalendars.id, calendarId));
}
