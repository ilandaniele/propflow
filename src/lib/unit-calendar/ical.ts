export type CalendarEvent = { uid: string; startsOn: string; endsOn: string; summary: string | null };

const MAX_EVENTS = 1000;
const MAX_UID = 255;
const MAX_SUMMARY = 200;

const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, '');

const unescapeText = (value: string) =>
  value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

const escapeText = (value: string) =>
  value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

function toIsoDate(value: string | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const toIcalDate = (isoDate: string) => isoDate.replaceAll('-', '');

const toIcalStamp = (date: Date) => `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

function toEvent(props: Record<string, string>): CalendarEvent | null {
  const startsOn = toIsoDate(props.DTSTART);
  const endsOn = toIsoDate(props.DTEND) ?? startsOn;
  if (!startsOn || !endsOn || endsOn < startsOn) return null;
  return {
    uid: (props.UID || `${startsOn}_${endsOn}`).slice(0, MAX_UID),
    startsOn,
    endsOn,
    summary: props.SUMMARY ? unescapeText(props.SUMMARY).slice(0, MAX_SUMMARY) : null,
  };
}

/** VEVENTs of an iCalendar feed as all-day ranges (end exclusive, as in DTEND). Deduplicated by UID, capped at 1000. */
export function parseIcalEvents(text: string): CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  let current: Record<string, string> | null = null;
  for (const line of unfold(text).split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      const event = current && toEvent(current);
      if (event) events.set(event.uid, event);
      current = null;
      if (events.size >= MAX_EVENTS) break;
    } else if (current) {
      const colon = line.indexOf(':');
      if (colon > 0) current[line.slice(0, colon).split(';')[0].toUpperCase()] = line.slice(colon + 1);
    }
  }
  return [...events.values()];
}

/** iCalendar feed of all-day events, the format Airbnb, Booking and Vrbo import. */
export function toIcal(events: CalendarEvent[], { name, now }: { name: string; now: Date }): string {
  const stamp = toIcalStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Propflow//Unit calendar//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcalDate(e.startsOn)}`,
      `DTEND;VALUE=DATE:${toIcalDate(e.endsOn)}`,
      `SUMMARY:${escapeText(e.summary ?? '')}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
