import { describe, it, expect } from 'vitest';
import { addDaysUtc, dayInZone, monthRange, parseMonth, shiftMonth } from '@/lib/ops-calendar/dates';
import { groupByDay, type CalendarEvent } from '@/lib/ops-calendar/events';
import { escapeText, foldLine, toICalendar } from '@/lib/ops-calendar/ical';
import { summarizeEvent } from '@/lib/ops-calendar/summary';

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  kind: 'contract_end', refId: 'c1', day: '2026-03-31', startAt: null, endAt: null,
  label: 'Ana', detail: '301', count: 1, ...over,
});

describe('dates', () => {
  it('parses and shifts months', () => {
    expect(parseMonth('2026-02', '2026-11-23')).toBe('2026-02');
    expect(parseMonth('2026-13', '2026-11-23')).toBe('2026-11');
    expect(parseMonth(undefined, '2026-11-23')).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(addDaysUtc('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('maps a timestamp to the Lima calendar day', () => {
    expect(dayInZone(Date.parse('2026-03-02T03:00:00Z'))).toBe('2026-03-01');
  });
});

describe('groupByDay', () => {
  it('keeps day order and groups events', () => {
    const groups = groupByDay([event({ day: '2026-03-01' }), event({ day: '2026-03-01', refId: 'c2' }), event({ day: '2026-03-02' })]);
    expect(groups.map((g) => [g.day, g.events.length])).toEqual([['2026-03-01', 2], ['2026-03-02', 1]]);
  });
});

describe('summarizeEvent', () => {
  it('joins kind title with label and detail', () => {
    expect(summarizeEvent(event(), () => 'Fin')).toBe('Fin: Ana · 301');
    expect(summarizeEvent(event({ label: null, detail: null }), () => '3 cobros')).toBe('3 cobros');
  });
});

describe('iCalendar', () => {
  it('escapes text values', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds long lines at 75 characters', () => {
    const folded = foldLine('x'.repeat(160)).split('\r\n');
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1).every((l) => l.startsWith(' ') && l.length <= 75)).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe('x'.repeat(160));
  });

  it('renders all-day and timed events with CRLF line endings', () => {
    const ics = toICalendar(
      [
        event(),
        event({ kind: 'visit', refId: 'v1', startAt: Date.parse('2026-03-02T15:00:00Z'), endAt: Date.parse('2026-03-02T15:30:00Z') }),
      ],
      { name: 'Ops', now: Date.parse('2026-03-01T00:00:00Z'), summarize: (e) => `S ${e.refId}` },
    );
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART;VALUE=DATE:20260331');
    expect(lines).toContain('DTEND;VALUE=DATE:20260401');
    expect(lines).toContain('DTSTART:20260302T150000Z');
    expect(lines).toContain('DTEND:20260302T153000Z');
    expect(lines).toContain('UID:visit-v1@propflow');
    expect(lines).toContain('DTSTAMP:20260301T000000Z');
    expect(lines).toContain('SUMMARY:S c1');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
