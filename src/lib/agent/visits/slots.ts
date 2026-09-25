/**
 * Pure slot-availability calculator (Phase 3-4, item A). No `db`, no `env`,
 * no new dependencies — every timezone conversion goes through `Intl`.
 *
 * Two building blocks do all the timezone work:
 *  - `localDateParts`: UTC instant -> local (timeZone) wall-clock parts.
 *  - `zonedWallTimeToUtc`: local wall-clock parts -> the UTC instant they
 *    denote (iterative, since `Intl` only converts one direction).
 * A wall time that doesn't exist (spring-forward gap) fails the round-trip
 * check in `computeAvailableSlots` and the candidate is silently dropped.
 * An ambiguous wall time (fall-back) resolves to whichever offset the
 * iteration converges to first.
 */

import type { Interval, Slot } from './types';

export interface WeeklyWindow {
  weekday: number; // 0 = Sunday, same as Date#getDay
  startMinute: number;
  endMinute: number;
}

export interface AdvisorSlotInput {
  profileId: string;
  windows: WeeklyWindow[];
  visitMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  daysAhead: number;
  stepMinutes: number;
  exceptions: Array<{ startsAt: Date; endsAt: Date; kind: 'block' | 'extra' }>;
  /** Visits' [starts_at, blocked_until) plus any external-provider intervals. */
  busy: Interval[];
}

export interface ComputeSlotsInput {
  timezone: string;
  now: Date;
  advisors: AdvisorSlotInput[];
  from?: Date;
  to?: Date;
}

// ── Intl plumbing ───────────────────────────────────────────────────────────

interface ZonedParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

function zonedPartsFromDate(at: Date, timeZone: string): ZonedParts {
  const parts = getPartsFormatter(timeZone).formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour) % 24,
    mm: Number(map.minute),
    weekday: WEEKDAY_MAP[map.weekday] ?? 0,
  };
}

/** Local (timeZone) wall-clock parts for a UTC instant. */
export function localDateParts(at: Date, timeZone: string): { y: number; m: number; d: number; weekday: number; minuteOfDay: number } {
  const p = zonedPartsFromDate(at, timeZone);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday, minuteOfDay: p.hh * 60 + p.mm };
}

/**
 * The UTC instant whose local wall-clock time in `timeZone` is
 * `y-m-d minuteOfDay`. Converges in a couple of iterations for any real
 * timezone (fixed or DST offsets change at most once around a given date).
 */
export function zonedWallTimeToUtc(y: number, m: number, d: number, minuteOfDay: number, timeZone: string): Date {
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  const desiredMs = Date.UTC(y, m - 1, d, hh, mm, 0);

  let guessMs = desiredMs;
  for (let i = 0; i < 3; i++) {
    const parts = zonedPartsFromDate(new Date(guessMs), timeZone);
    const actualMs = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, 0);
    const diff = desiredMs - actualMs;
    if (diff === 0) break;
    guessMs += diff;
  }
  return new Date(guessMs);
}

/** "mié 1 oct, 10:30" (es-PE). */
export function formatSlotLabel(startsAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('es-PE', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(startsAt);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const stripDot = (s: string) => s.replace(/\.$/, '');

  return `${stripDot(map.weekday ?? '')} ${map.day} ${stripDot(map.month ?? '')}, ${map.hour}:${map.minute}`;
}

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ordered by startsAt, then profileId. */
export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const { timezone, now } = input;
  const rangeFrom = input.from && input.from > now ? input.from : now;
  const results: Slot[] = [];

  const todayParts = localDateParts(now, timezone);
  const startParts = localDateParts(rangeFrom, timezone);
  // Abstract calendar date (UTC-based, timezone-agnostic) — safe to walk +1 day at a time.
  const calDate = new Date(Date.UTC(startParts.y, startParts.m - 1, startParts.d));
  const horizonStart = new Date(Date.UTC(todayParts.y, todayParts.m - 1, todayParts.d));

  for (const advisor of input.advisors) {
    const earliestStart = new Date(now.getTime() + advisor.minNoticeMinutes * 60_000);
    const horizonEndCal = new Date(horizonStart.getTime() + advisor.daysAhead * DAY_MS);
    const horizonEndY = horizonEndCal.getUTCFullYear();
    const horizonEndM = horizonEndCal.getUTCMonth() + 1;
    const horizonEndD = horizonEndCal.getUTCDate();
    const horizonEnd = zonedWallTimeToUtc(horizonEndY, horizonEndM, horizonEndD, 0, timezone);
    const rangeTo = input.to && input.to < horizonEnd ? input.to : horizonEnd;

    if (rangeFrom >= rangeTo) continue;

    let cursor = new Date(calDate.getTime());
    while (true) {
      const y = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth() + 1;
      const d = cursor.getUTCDate();
      const localMidnight = zonedWallTimeToUtc(y, m, d, 0, timezone);
      if (localMidnight >= rangeTo) break;

      const weekday = cursor.getUTCDay();
      const dayWindows: Array<{ startMinute: number; endMinute: number }> = advisor.windows
        .filter((w) => w.weekday === weekday)
        .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute }));

      const dayStart = localMidnight;
      const nextLocalMidnight = zonedWallTimeToUtc(
        new Date(cursor.getTime() + DAY_MS).getUTCFullYear(),
        new Date(cursor.getTime() + DAY_MS).getUTCMonth() + 1,
        new Date(cursor.getTime() + DAY_MS).getUTCDate(),
        0,
        timezone,
      );

      for (const ex of advisor.exceptions) {
        if (ex.kind !== 'extra') continue;
        if (!intervalsOverlap(ex.startsAt, ex.endsAt, dayStart, nextLocalMidnight)) continue;
        const clipStart = ex.startsAt > dayStart ? ex.startsAt : dayStart;
        const clipEndExclusive = ex.endsAt < nextLocalMidnight ? ex.endsAt : nextLocalMidnight;
        if (clipEndExclusive <= clipStart) continue;
        const startMinute = localDateParts(clipStart, timezone).minuteOfDay;
        const endMinute = localDateParts(new Date(clipEndExclusive.getTime() - 1), timezone).minuteOfDay + 1;
        dayWindows.push({ startMinute, endMinute: Math.min(endMinute, 1440) });
      }

      for (const window of dayWindows) {
        for (let s = window.startMinute; s + advisor.visitMinutes <= window.endMinute; s += advisor.stepMinutes) {
          const candidateStart = zonedWallTimeToUtc(y, m, d, s, timezone);

          // Round-trip check — drops wall times that don't exist (DST gap).
          const roundTrip = localDateParts(candidateStart, timezone);
          if (roundTrip.minuteOfDay !== s || roundTrip.d !== d || roundTrip.m !== m || roundTrip.y !== y) continue;

          if (candidateStart < rangeFrom || candidateStart < earliestStart || candidateStart >= rangeTo) continue;

          const candidateEnd = new Date(candidateStart.getTime() + advisor.visitMinutes * 60_000);
          const candidateBlockedUntil = new Date(candidateEnd.getTime() + advisor.bufferMinutes * 60_000);

          const blocked = advisor.exceptions.some(
            (ex) => ex.kind === 'block' && intervalsOverlap(candidateStart, candidateEnd, ex.startsAt, ex.endsAt),
          );
          if (blocked) continue;

          // Same predicate as the DB EXCLUDE constraint: [starts, blocked_until) must not overlap busy.
          const busyHit = advisor.busy.some((b) => intervalsOverlap(candidateStart, candidateBlockedUntil, b.start, b.end));
          if (busyHit) continue;

          results.push({ profileId: advisor.profileId, startsAt: candidateStart, endsAt: candidateEnd, bufferMinutes: advisor.bufferMinutes });
        }
      }

      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  }

  results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.profileId.localeCompare(b.profileId));
  return results;
}

export interface OfferOptions {
  max?: number; // default 8
  maxPerDay?: number; // default 3
  preferredProfileId?: string | null;
  loadByProfile?: Record<string, number>;
  timeZone: string;
  partOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
}

function partOfDayOf(minuteOfDay: number): 'morning' | 'afternoon' | 'evening' {
  const hour = minuteOfDay / 60;
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Dedupe across advisors, then spread across days within max/maxPerDay caps. */
export function pickSlotsForOffer(slots: Slot[], opts: OfferOptions): Slot[] {
  const max = opts.max ?? 8;
  const maxPerDay = opts.maxPerDay ?? 3;
  const load = opts.loadByProfile ?? {};

  let candidates = slots;
  if (opts.partOfDay && opts.partOfDay !== 'any') {
    candidates = candidates.filter((s) => partOfDayOf(localDateParts(s.startsAt, opts.timeZone).minuteOfDay) === opts.partOfDay);
  }

  const byStart = new Map<number, Slot[]>();
  for (const s of candidates) {
    const key = s.startsAt.getTime();
    const arr = byStart.get(key);
    if (arr) arr.push(s);
    else byStart.set(key, [s]);
  }

  const orderedKeys = Array.from(byStart.keys()).sort((a, b) => a - b);
  const deduped: Slot[] = [];
  for (const key of orderedKeys) {
    const group = byStart.get(key)!;
    let chosen = opts.preferredProfileId ? group.find((s) => s.profileId === opts.preferredProfileId) : undefined;
    if (!chosen) {
      chosen = [...group].sort((a, b) => {
        const la = load[a.profileId] ?? 0;
        const lb = load[b.profileId] ?? 0;
        if (la !== lb) return la - lb;
        return a.profileId.localeCompare(b.profileId);
      })[0];
    }
    deduped.push(chosen);
  }

  const picked: Slot[] = [];
  const perDay = new Map<string, number>();
  for (const s of deduped) {
    if (picked.length >= max) break;
    const parts = localDateParts(s.startsAt, opts.timeZone);
    const dayKey = `${parts.y}-${parts.m}-${parts.d}`;
    const count = perDay.get(dayKey) ?? 0;
    if (count >= maxPerDay) continue;
    perDay.set(dayKey, count + 1);
    picked.push(s);
  }

  return picked;
}
