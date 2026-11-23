import { describe, it, expect } from 'vitest';
import { parseIcalEvents, toIcal } from '@/lib/unit-calendar/ical';
import { isAllowedCalendarUrl } from '@/lib/unit-calendar/remote';
import { addDays, contractsToEvents } from '@/lib/unit-calendar/occupancy';
import { UnitCalendarImportSchema } from '@/lib/unit-calendar/schemas';

const AIRBNB_FEED = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20261205',
  'DTSTART;VALUE=DATE:20261201',
  'UID:abc-123@airbnb.com',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261210T150000Z',
  'DTEND:20261212T110000Z',
  'UID:long-uid-',
  ' continued',
  'SUMMARY:Airbnb (Not available)\\, owner',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261220',
  'DTEND;VALUE=DATE:20261218',
  'UID:backwards',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcalEvents', () => {
  it('reads date and datetime events, unfolds lines and unescapes text', () => {
    expect(parseIcalEvents(AIRBNB_FEED)).toEqual([
      { uid: 'abc-123@airbnb.com', startsOn: '2026-12-01', endsOn: '2026-12-05', summary: 'Reserved' },
      { uid: 'long-uid-continued', startsOn: '2026-12-10', endsOn: '2026-12-12', summary: 'Airbnb (Not available), owner' },
    ]);
  });

  it('dedupes by UID and defaults a missing DTEND to DTSTART', () => {
    const feed = ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260101', 'UID:x', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260102', 'UID:x', 'END:VEVENT'].join('\n');
    expect(parseIcalEvents(feed)).toEqual([{ uid: 'x', startsOn: '2026-01-02', endsOn: '2026-01-02', summary: null }]);
  });

  it('round-trips its own export', () => {
    const events = [{ uid: 'contract-1@propflow', startsOn: '2026-01-01', endsOn: '2026-07-01', summary: 'Not available; a, b' }];
    const ics = toIcal(events, { name: 'Depa 101', now: new Date('2026-01-01T00:00:00Z') });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260101\r\n');
    expect(ics).toContain('DTSTAMP:20260101T000000Z\r\n');
    expect(ics).toContain('SUMMARY:Not available\\; a\\, b\r\n');
    expect(parseIcalEvents(ics)).toEqual(events);
  });
});

describe('isAllowedCalendarUrl', () => {
  it.each([
    'https://www.airbnb.com/calendar/ical/1.ics?s=abc',
    'https://www.airbnb.com.pe/calendar/ical/1.ics',
    'https://es.airbnb.com/calendar/ical/1.ics',
    'https://admin.booking.com/hotel/hoteladmin/ical.html?t=x',
    'https://www.vrbo.com/icalendar/x.ics',
  ])('allows %s', (url) => expect(isAllowedCalendarUrl(url)).toBe(true));

  it.each([
    'http://www.airbnb.com/calendar/ical/1.ics',
    'https://evil.com/airbnb.com.ics',
    'https://airbnb.com.evil.com/x.ics',
    'https://user:pass@www.airbnb.com/x.ics',
    'https://169.254.169.254/latest',
    'not a url',
  ])('rejects %s', (url) => expect(isAllowedCalendarUrl(url)).toBe(false));
});

describe('contractsToEvents', () => {
  it('makes the inclusive contract end exclusive and blocks open-ended contracts a year ahead', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(contractsToEvents([
      { id: 'a', startDate: '2026-01-01', endDate: '2026-06-30' },
      { id: 'b', startDate: '2026-07-01', endDate: null },
    ], '2026-03-01')).toEqual([
      { uid: 'contract-a@propflow', startsOn: '2026-01-01', endsOn: '2026-07-01', summary: 'Not available' },
      { uid: 'contract-b@propflow', startsOn: '2026-07-01', endsOn: '2027-03-02', summary: 'Not available' },
    ]);
  });
});

describe('UnitCalendarImportSchema', () => {
  it('turns an empty URL into null and rejects other hosts', () => {
    expect(UnitCalendarImportSchema.parse({ unit_id: 'u', import_url: '  ' }).import_url).toBeNull();
    expect(UnitCalendarImportSchema.safeParse({ unit_id: 'u', import_url: 'https://example.com/x.ics' }).success).toBe(false);
  });
});
