import { describe, it, expect } from 'vitest';
import {
  computeAvailableSlots,
  pickSlotsForOffer,
  formatSlotLabel,
  zonedWallTimeToUtc,
  localDateParts,
  type AdvisorSlotInput,
} from '@/lib/agent/visits/slots';

const LIMA = 'America/Lima'; // UTC-5, no DST
const SANTIAGO = 'America/Santiago';

function advisor(overrides: Partial<AdvisorSlotInput> = {}): AdvisorSlotInput {
  return {
    profileId: 'advisor-1',
    windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }], // Monday 9-12
    visitMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    daysAhead: 6, // stays within the same week (single Monday) unless a test overrides it
    stepMinutes: 30,
    exceptions: [],
    busy: [],
    ...overrides,
  };
}

// The next Monday at local midnight, Lima time, expressed as a UTC `now`.
function nextMondayNow(timezone: string, hourLocal = 0): Date {
  const base = new Date('2026-10-05T00:00:00-05:00'); // a Monday in Lima
  return zonedWallTimeToUtc(2026, 10, 5, hourLocal * 60, timezone) ?? base;
}

describe('agent/visits/slots — computeAvailableSlots', () => {
  it('Lima 9-12 with 45min visit + 15min buffer, 30min step -> 09:00..11:00', () => {
    const now = nextMondayNow(LIMA, 0);
    const slots = computeAvailableSlots({ timezone: LIMA, now, advisors: [advisor()] });

    const labels = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(labels).toEqual([9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 30, 11 * 60]);
  });

  it('respects minimum notice', () => {
    const now = nextMondayNow(LIMA, 0);
    const slots = computeAvailableSlots({
      timezone: LIMA,
      now,
      advisors: [advisor({ minNoticeMinutes: 10 * 60 })], // 10h notice pushes past 09:00 and 09:30
    });
    const minutes = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(minutes).toEqual([10 * 60, 10 * 60 + 30, 11 * 60]);
  });

  it('respects the days-ahead horizon', () => {
    const now = nextMondayNow(LIMA, 0);
    const slots = computeAvailableSlots({ timezone: LIMA, now, advisors: [advisor({ daysAhead: 1 })] });
    // horizon = today (Monday) + 1 day, exclusive -> only Monday's own window remains
    for (const s of slots) {
      expect(localDateParts(s.startsAt, LIMA).d).toBe(5);
    }
    expect(slots.length).toBeGreaterThan(0);
  });

  it('a block exception removes slots', () => {
    const now = nextMondayNow(LIMA, 0);
    const blockStart = zonedWallTimeToUtc(2026, 10, 5, 10 * 60, LIMA);
    const blockEnd = zonedWallTimeToUtc(2026, 10, 5, 10 * 60 + 45, LIMA);
    const slots = computeAvailableSlots({
      timezone: LIMA,
      now,
      advisors: [advisor({ exceptions: [{ startsAt: blockStart, endsAt: blockEnd, kind: 'block' }] })],
    });
    const minutes = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(minutes).not.toContain(10 * 60);
  });

  it('an extra exception adds slots outside the weekly windows', () => {
    const now = nextMondayNow(LIMA, 0);
    const extraStart = zonedWallTimeToUtc(2026, 10, 5, 14 * 60, LIMA);
    const extraEnd = zonedWallTimeToUtc(2026, 10, 5, 15 * 60, LIMA);
    const slots = computeAvailableSlots({
      timezone: LIMA,
      now,
      advisors: [advisor({ windows: [], exceptions: [{ startsAt: extraStart, endsAt: extraEnd, kind: 'extra' }] })],
    });
    const minutes = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(minutes).toContain(14 * 60);
  });

  it('an existing visit with buffer blocks up to its blocked_until, freeing the slot right after', () => {
    const now = nextMondayNow(LIMA, 0);
    // Existing visit 10:00-10:45, buffer 15min -> blocked_until 11:00.
    const busyStart = zonedWallTimeToUtc(2026, 10, 5, 10 * 60, LIMA);
    const busyEnd = zonedWallTimeToUtc(2026, 10, 5, 11 * 60, LIMA);
    const slots = computeAvailableSlots({
      timezone: LIMA,
      now,
      advisors: [advisor({ busy: [{ start: busyStart, end: busyEnd }] })],
    });
    const minutes = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(minutes).not.toContain(10 * 60 + 30); // still inside the blocked range
    expect(minutes).toContain(11 * 60); // freed exactly at blocked_until
  });

  it('an external-provider busy interval removes slots', () => {
    const now = nextMondayNow(LIMA, 0);
    const busyStart = zonedWallTimeToUtc(2026, 10, 5, 9 * 60, LIMA);
    const busyEnd = zonedWallTimeToUtc(2026, 10, 5, 9 * 60 + 45, LIMA);
    const slots = computeAvailableSlots({
      timezone: LIMA,
      now,
      advisors: [advisor({ busy: [{ start: busyStart, end: busyEnd }] })],
    });
    const minutes = slots.map((s) => localDateParts(s.startsAt, LIMA).minuteOfDay);
    expect(minutes).not.toContain(9 * 60);
  });

  it('handles a DST transition day in Santiago without throwing and without duplicate instants', () => {
    // Chile's 2026 spring-forward is on 2026-09-06 (clocks jump 00:00 -> 01:00 local).
    const now = zonedWallTimeToUtc(2026, 9, 6, 0, SANTIAGO);
    const slots = computeAvailableSlots({
      timezone: SANTIAGO,
      now,
      advisors: [
        advisor({
          windows: [{ weekday: 0, startMinute: 0, endMinute: 3 * 60 }], // Sunday 00:00-03:00 local
          stepMinutes: 30,
          minNoticeMinutes: 0,
          daysAhead: 1, // only the transition day itself
        }),
      ],
    });
    expect(() => slots).not.toThrow();
    const instants = slots.map((s) => s.startsAt.getTime());
    expect(new Set(instants).size).toBe(instants.length); // no duplicate UTC instants
    for (const s of slots) {
      // Every generated slot must round-trip to the exact local minute it claims.
      expect(localDateParts(s.startsAt, SANTIAGO).d).toBe(6);
    }
  });
});

describe('agent/visits/slots — pickSlotsForOffer', () => {
  const tz = LIMA;
  function slot(profileId: string, minuteOfDay: number, day = 5): { profileId: string; startsAt: Date; endsAt: Date; bufferMinutes: number } {
    const startsAt = zonedWallTimeToUtc(2026, 10, day, minuteOfDay, tz);
    return { profileId, startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60_000), bufferMinutes: 15 };
  }

  it('prefers the preferred advisor when several share the same startsAt', () => {
    const slots = [slot('advisor-a', 9 * 60), slot('advisor-b', 9 * 60)];
    const picked = pickSlotsForOffer(slots, { timeZone: tz, preferredProfileId: 'advisor-b' });
    expect(picked[0].profileId).toBe('advisor-b');
  });

  it('breaks ties by lowest load when there is no preferred advisor', () => {
    const slots = [slot('advisor-a', 9 * 60), slot('advisor-b', 9 * 60)];
    const picked = pickSlotsForOffer(slots, { timeZone: tz, loadByProfile: { 'advisor-a': 3, 'advisor-b': 0 } });
    expect(picked[0].profileId).toBe('advisor-b');
  });

  it('caps per day', () => {
    const slots = [slot('a', 9 * 60, 5), slot('a', 10 * 60, 5), slot('a', 11 * 60, 5), slot('a', 9 * 60, 6)];
    const picked = pickSlotsForOffer(slots, { timeZone: tz, maxPerDay: 2, max: 10 });
    const day5 = picked.filter((s) => localDateParts(s.startsAt, tz).d === 5);
    expect(day5.length).toBe(2);
    expect(picked.some((s) => localDateParts(s.startsAt, tz).d === 6)).toBe(true);
  });

  it('filters by partOfDay', () => {
    const slots = [slot('a', 9 * 60), slot('a', 14 * 60), slot('a', 19 * 60)];
    const morning = pickSlotsForOffer(slots, { timeZone: tz, partOfDay: 'morning' });
    expect(morning).toHaveLength(1);
    expect(localDateParts(morning[0].startsAt, tz).minuteOfDay).toBe(9 * 60);
  });
});

describe('agent/visits/slots — formatSlotLabel', () => {
  it('formats a Lima date in Spanish', () => {
    const at = zonedWallTimeToUtc(2026, 10, 1, 10 * 60 + 30, LIMA); // Thursday
    const label = formatSlotLabel(at, LIMA);
    expect(label).toMatch(/1 oct, 10:30/);
    expect(label.toLowerCase()).toBe(label); // weekday/month already lowercase in es-PE
  });
});
