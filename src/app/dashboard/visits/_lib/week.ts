/**
 * Monday-anchored week math for the /dashboard/visits grid — pure calendar
 * arithmetic (no timezone-sensitive Date math beyond the two boundary
 * conversions, which go through slots.ts's zonedWallTimeToUtc/localDateParts).
 */

import { localDateParts, zonedWallTimeToUtc } from '@/lib/agent/visits/slots';

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatDateParts(p: DateParts): string {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function parseDateString(s: string): DateParts | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Adds `days` (may be negative) to a calendar date, correctly rolling over months/years. */
export function addCalendarDays(p: DateParts, days: number): DateParts {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Monday of the calendar week containing `weekday` (Date#getDay() convention: 0 = Sunday). */
export function mondayOf(p: DateParts, weekday: number): DateParts {
  const offset = (weekday + 6) % 7; // Monday -> 0, Sunday -> 6
  return addCalendarDays(p, -offset);
}

/** The Monday of `now`'s local week in the org's timezone, as 'YYYY-MM-DD'. */
export function currentWeekStart(now: Date, timeZone: string): string {
  const parts = localDateParts(now, timeZone);
  return formatDateParts(mondayOf(parts, parts.weekday));
}

export interface WeekRange {
  weekStart: string; // Monday, 'YYYY-MM-DD'
  days: DateParts[]; // 7 calendar dates, Monday..Sunday
  fromUtc: Date;
  toUtc: Date; // exclusive
}

/** Resolves a `week` search param into a Monday-anchored range, defaulting to the current week. */
export function resolveWeekRange(weekParam: string | undefined, now: Date, timeZone: string): WeekRange {
  const requested = weekParam ? parseDateString(weekParam) : null;
  const nowParts = localDateParts(now, timeZone);
  const monday = requested ? mondayOf(requested, localWeekdayOf(requested)) : mondayOf(nowParts, nowParts.weekday);

  const days: DateParts[] = [];
  for (let i = 0; i < 7; i++) days.push(addCalendarDays(monday, i));
  const weekEnd = addCalendarDays(monday, 7);

  const fromUtc = zonedWallTimeToUtc(monday.y, monday.m, monday.d, 0, timeZone);
  const toUtc = zonedWallTimeToUtc(weekEnd.y, weekEnd.m, weekEnd.d, 0, timeZone);

  return { weekStart: formatDateParts(monday), days, fromUtc, toUtc };
}

/** Date#getDay() weekday (0 = Sunday) for a bare calendar date, independent of any timezone. */
function localWeekdayOf(p: DateParts): number {
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}
