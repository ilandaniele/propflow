import { addDaysUtc } from './dates';
import type { CalendarEvent } from './events';

const CRLF = '\r\n';
const MAX_LINE = 75;

export function escapeText(value: string): string {
  return value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

export function foldLine(line: string): string {
  const chars = [...line];
  if (chars.length <= MAX_LINE) return line;
  const parts = [chars.slice(0, MAX_LINE).join('')];
  for (let i = MAX_LINE; i < chars.length; i += MAX_LINE - 1) parts.push(` ${chars.slice(i, i + MAX_LINE - 1).join('')}`);
  return parts.join(CRLF);
}

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function compactDay(day: string): string {
  return day.replace(/-/g, '');
}

function eventLines(event: CalendarEvent, summary: string, stamp: string): string[] {
  const when = event.startAt !== null
    ? [`DTSTART:${utcStamp(event.startAt)}`, `DTEND:${utcStamp(event.endAt ?? event.startAt)}`]
    : [`DTSTART;VALUE=DATE:${compactDay(event.day)}`, `DTEND;VALUE=DATE:${compactDay(addDaysUtc(event.day, 1))}`];
  return [
    'BEGIN:VEVENT',
    `UID:${event.kind}-${event.refId}@propflow`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(summary)}`,
    'END:VEVENT',
  ];
}

export function toICalendar(
  events: CalendarEvent[],
  options: { name: string; now: number; summarize: (event: CalendarEvent) => string },
): string {
  const stamp = utcStamp(options.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PropFlow//Operational calendar//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    ...events.flatMap((event) => eventLines(event, options.summarize(event), stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
