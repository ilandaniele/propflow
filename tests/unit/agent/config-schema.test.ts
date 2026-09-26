import { describe, it, expect } from 'vitest';
import {
  parseBusinessHours,
  parseVoiceConfig,
  clampCallWindow,
  nextWindowStart,
  isWithinWeeklyRanges,
  IdentitySchema,
  VoiceConfigSchema,
} from '@/lib/agent/config-schema';

describe('agent/config-schema — parseBusinessHours', () => {
  it('returns Mon-Fri 9-19 + Sat 9-13 defaults for null/garbage input', () => {
    const defaults = parseBusinessHours(null);
    expect(defaults.weekly).toHaveLength(6);
    expect(defaults.closedNote).toBeNull();
    expect(parseBusinessHours('garbage')).toEqual(defaults);
    expect(parseBusinessHours(undefined)).toEqual(defaults);
  });

  it('drops invalid/overlapping ranges (endMinute <= startMinute) but keeps valid ones', () => {
    const parsed = parseBusinessHours({
      weekly: [
        { weekday: 1, startMinute: 540, endMinute: 1140 },
        { weekday: 2, startMinute: 900, endMinute: 800 }, // invalid: end before start
        { weekday: 9, startMinute: 0, endMinute: 60 }, // invalid weekday
      ],
      closedNote: 'Cerrado los domingos',
    });
    expect(parsed.weekly).toEqual([{ weekday: 1, startMinute: 540, endMinute: 1140 }]);
    expect(parsed.closedNote).toBe('Cerrado los domingos');
  });

  it('falls back to defaults when every range is invalid, so businessHours is never empty', () => {
    const parsed = parseBusinessHours({ weekly: [{ weekday: 1, startMinute: 100, endMinute: 50 }] });
    expect(parsed.weekly.length).toBeGreaterThan(0);
  });
});

describe('agent/config-schema — IdentitySchema timezone validation', () => {
  it('accepts a valid IANA timezone', () => {
    expect(IdentitySchema.safeParse({ persona: 'Ana', tone: 'profesional', timezone: 'America/Lima' }).success).toBe(true);
  });

  it('rejects an invalid timezone', () => {
    const result = IdentitySchema.safeParse({ persona: 'Ana', tone: 'profesional', timezone: 'Not/A_Zone' });
    expect(result.success).toBe(false);
  });
});

describe('agent/config-schema — clampCallWindow', () => {
  it('hard-clamps to 08:00-21:00 (480-1260) regardless of the stored config', () => {
    expect(clampCallWindow({ weekdays: [1, 2], startMinute: 0, endMinute: 1439 })).toEqual({
      weekdays: [1, 2],
      startMinute: 480,
      endMinute: 1260,
    });
  });

  it('drops weekday 0 (Sunday) and 7+ — outbound weekdays are 1..6', () => {
    expect(clampCallWindow({ weekdays: [0, 1, 7], startMinute: 540, endMinute: 1200 }).weekdays).toEqual([1]);
  });

  it('dedupes weekdays and never returns more than 7', () => {
    expect(clampCallWindow({ weekdays: [1, 1, 2, 2, 3], startMinute: 540, endMinute: 1200 }).weekdays).toEqual([1, 2, 3]);
  });

  it('forces endMinute strictly after startMinute even if the stored value is inverted/equal', () => {
    const { startMinute, endMinute } = clampCallWindow({ weekdays: [1], startMinute: 900, endMinute: 900 });
    expect(endMinute).toBeGreaterThan(startMinute);
  });
});

describe('agent/config-schema — VoiceConfigSchema', () => {
  const base = {
    voiceProvider: 'azure' as const,
    voiceId: 'es-PE-CamilaNeural',
    language: 'es' as const,
    recordingEnabled: true,
    greetingExtra: null,
    maxCallMinutes: 10,
    monthlyMinuteCap: 300,
    callWindow: { weekdays: [1, 2, 3], startMinute: 540, endMinute: 1140 },
    speedToLead: { enabled: false, delayMinutes: 2, sources: ['manual'] as const, staleAfterHours: 12 },
    visitConfirmation: { enabled: false, hoursBefore: 20 },
    reactivation: { enabled: false, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 },
  };

  it('accepts a well-formed config', () => {
    expect(VoiceConfigSchema.safeParse(base).success).toBe(true);
  });

  it('rejects callWindow.weekdays with duplicates or more than 7 entries', () => {
    expect(VoiceConfigSchema.safeParse({ ...base, callWindow: { ...base.callWindow, weekdays: [1, 1] } }).success).toBe(false);
    expect(VoiceConfigSchema.safeParse({ ...base, callWindow: { ...base.callWindow, weekdays: [1, 2, 3, 4, 5, 6, 1] } }).success).toBe(false);
  });

  it('rejects callWindow.endMinute <= startMinute', () => {
    expect(VoiceConfigSchema.safeParse({ ...base, callWindow: { weekdays: [1], startMinute: 600, endMinute: 600 } }).success).toBe(false);
    expect(VoiceConfigSchema.safeParse({ ...base, callWindow: { weekdays: [1], startMinute: 600, endMinute: 500 } }).success).toBe(false);
  });

  it('rejects speedToLead.sources with duplicates or more than 5 entries', () => {
    expect(VoiceConfigSchema.safeParse({ ...base, speedToLead: { ...base.speedToLead, sources: ['manual', 'manual'] } }).success).toBe(false);
  });

  it('rejects staleAfterHours/coldAfterDays/minDaysBetween beyond their max bounds', () => {
    expect(VoiceConfigSchema.safeParse({ ...base, speedToLead: { ...base.speedToLead, staleAfterHours: 8761 } }).success).toBe(false);
    expect(VoiceConfigSchema.safeParse({ ...base, reactivation: { ...base.reactivation, coldAfterDays: 366 } }).success).toBe(false);
    expect(VoiceConfigSchema.safeParse({ ...base, reactivation: { ...base.reactivation, minDaysBetween: 366 } }).success).toBe(false);
  });
});

describe('agent/config-schema — parseVoiceConfig', () => {
  it('deep-defaults a partial/garbage stored value without throwing', () => {
    expect(() => parseVoiceConfig(null)).not.toThrow();
    expect(() => parseVoiceConfig({ maxCallMinutes: 'not-a-number' })).not.toThrow();
    const parsed = parseVoiceConfig({ maxCallMinutes: 'not-a-number' });
    expect(parsed.maxCallMinutes).toBe(10); // default
  });

  it('clamps maxCallMinutes and monthlyMinuteCap into range', () => {
    const parsed = parseVoiceConfig({ maxCallMinutes: 999, monthlyMinuteCap: -5 });
    expect(parsed.maxCallMinutes).toBe(30);
    expect(parsed.monthlyMinuteCap).toBe(0);
  });

  it('falls back speedToLead.sources to ["manual"] when empty/invalid', () => {
    const parsed = parseVoiceConfig({ speedToLead: { sources: ['bogus'] } });
    expect(parsed.speedToLead.sources).toEqual(['manual']);
  });

  it('dedupes speedToLead.sources and caps it at 5', () => {
    const parsed = parseVoiceConfig({ speedToLead: { sources: ['manual', 'manual', 'web', 'whatsapp'] } });
    expect(parsed.speedToLead.sources).toEqual(['manual', 'web', 'whatsapp']);
  });

  it('clamps staleAfterHours/coldAfterDays/minDaysBetween into their max bounds', () => {
    const parsed = parseVoiceConfig({
      speedToLead: { staleAfterHours: 999_999 },
      reactivation: { coldAfterDays: 999_999, minDaysBetween: 999_999 },
    });
    expect(parsed.speedToLead.staleAfterHours).toBe(8760);
    expect(parsed.reactivation.coldAfterDays).toBe(365);
    expect(parsed.reactivation.minDaysBetween).toBe(365);
  });

  it('dedupes callWindow.weekdays via clampCallWindow', () => {
    const parsed = parseVoiceConfig({ callWindow: { weekdays: [1, 1, 2] } });
    expect(parsed.callWindow.weekdays).toEqual([1, 2]);
  });
});

describe('agent/config-schema — isWithinWeeklyRanges / nextWindowStart', () => {
  const weekly = [{ weekday: 1, startMinute: 540, endMinute: 1140 }]; // Monday 09:00-19:00

  it('isWithinWeeklyRanges is true inside the window and false outside it', () => {
    // 2026-06-01 is a Monday.
    const inside = new Date('2026-06-01T14:00:00-05:00'); // 14:00 Lima time (UTC-5)
    const outside = new Date('2026-06-01T20:00:00-05:00');
    expect(isWithinWeeklyRanges(weekly, inside, 'America/Lima')).toBe(true);
    expect(isWithinWeeklyRanges(weekly, outside, 'America/Lima')).toBe(false);
  });

  it('nextWindowStart scans forward across a Sunday to the next Monday', () => {
    const sunday = new Date('2026-05-31T12:00:00-05:00');
    const next = nextWindowStart({ weekdays: [1], startMinute: 540, endMinute: 1140 }, sunday, 'America/Lima');
    expect(next.getTime()).toBeGreaterThan(sunday.getTime());
    // Should land on Monday 09:00 Lima time.
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(next);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    expect(map.weekday).toBe('Mon');
  });

  it('nextWindowStart converges across a DST-shifting timezone (Santiago) without throwing', () => {
    const now = new Date('2026-08-30T12:00:00Z'); // ~around a Chile DST boundary
    expect(() => nextWindowStart({ weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1140 }, now, 'America/Santiago')).not.toThrow();
  });
});
