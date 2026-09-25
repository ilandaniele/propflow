/**
 * Pure validation/defaults for agent_configs' JSONB columns. The only source
 * of truth for what a valid AgentConfig field looks like — item D's settings
 * actions, config.ts (updateAgentConfig) and the voice modules all import
 * from here instead of re-validating ad hoc. zod v3 (matches leads/types.ts;
 * tools use zod/v4 — see AGENTS.md's split).
 *
 * Strings stored through these schemas are trimmed and stripped of C0/C1
 * control characters first (sanitizeText), so a pasted value with stray
 * control bytes never reaches the DB.
 */

import { z } from 'zod';

export const QUALIFICATION_FIELDS = [
  'operation_type',
  'zones',
  'budget_min',
  'budget_max',
  'bedrooms_min',
  'move_in_date',
  'timeline',
  'pets',
  'full_name',
] as const;

export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];

export interface WeeklyRange {
  weekday: number; // 0-6, 0 = Sunday
  startMinute: number;
  endMinute: number;
}

export interface BusinessHours {
  weekly: WeeklyRange[];
  closedNote: string | null; // <=300 chars
}

export interface VoiceConfig {
  voiceProvider: 'azure' | '11labs' | 'openai';
  voiceId: string; // <=80 chars
  language: 'es' | 'en' | 'pt';
  recordingEnabled: boolean;
  greetingExtra: string | null; // <=200 chars, appended after the disclosure
  maxCallMinutes: number; // 1..30
  monthlyMinuteCap: number; // 0..100000
  callWindow: { weekdays: number[]; startMinute: number; endMinute: number };
  speedToLead: { enabled: boolean; delayMinutes: number; sources: Array<'manual' | 'web' | 'whatsapp'>; staleAfterHours: number };
  visitConfirmation: { enabled: boolean; hoursBefore: number };
  reactivation: { enabled: boolean; coldAfterDays: number; minDaysBetween: number; maxPerRun: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trims and strips C0/C1 control characters (everything except \n\t is kept out — these are one-line/short fields). */
function sanitizeText(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  weekly: [
    { weekday: 1, startMinute: 540, endMinute: 1140 },
    { weekday: 2, startMinute: 540, endMinute: 1140 },
    { weekday: 3, startMinute: 540, endMinute: 1140 },
    { weekday: 4, startMinute: 540, endMinute: 1140 },
    { weekday: 5, startMinute: 540, endMinute: 1140 },
    { weekday: 6, startMinute: 540, endMinute: 780 },
  ],
  closedNote: null,
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voiceProvider: 'azure',
  voiceId: 'es-PE-CamilaNeural',
  language: 'es',
  recordingEnabled: true,
  greetingExtra: null,
  maxCallMinutes: 10,
  monthlyMinuteCap: 300,
  callWindow: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 },
  speedToLead: { enabled: false, delayMinutes: 2, sources: ['manual'], staleAfterHours: 12 },
  visitConfirmation: { enabled: false, hoursBefore: 20 },
  reactivation: { enabled: false, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const WeeklyRangeSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, { message: 'endMinute must be after startMinute' });

export const BusinessHoursSchema: z.ZodType<BusinessHours> = z.object({
  weekly: z.array(WeeklyRangeSchema).max(7 * 4), // generous — up to 4 ranges/day
  closedNote: z.string().max(300).nullable(),
});

const CallWindowSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(6)),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

export const VoiceConfigSchema: z.ZodType<VoiceConfig> = z.object({
  voiceProvider: z.enum(['azure', '11labs', 'openai']),
  voiceId: z.string().min(1).max(80),
  language: z.enum(['es', 'en', 'pt']),
  recordingEnabled: z.boolean(),
  greetingExtra: z.string().max(200).nullable(),
  maxCallMinutes: z.number().int().min(1).max(30),
  monthlyMinuteCap: z.number().int().min(0).max(100_000),
  callWindow: CallWindowSchema,
  speedToLead: z.object({
    enabled: z.boolean(),
    delayMinutes: z.number().int().min(1).max(60),
    sources: z.array(z.enum(['manual', 'web', 'whatsapp'])),
    staleAfterHours: z.number().int().positive(),
  }),
  visitConfirmation: z.object({
    enabled: z.boolean(),
    hoursBefore: z.number().int().min(4).max(48),
  }),
  reactivation: z.object({
    enabled: z.boolean(),
    coldAfterDays: z.number().int().positive(),
    minDaysBetween: z.number().int().positive(),
    maxPerRun: z.number().int().min(1).max(200),
  }),
});

const FaqEntrySchema = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(1000),
});

export const FaqSchema = z.array(FaqEntrySchema).max(50);

/** A timezone is valid iff `new Intl.DateTimeFormat(undefined, { timeZone })` doesn't throw. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const IdentitySchema = z.object({
  persona: z.string().min(2).max(60),
  tone: z.enum(['profesional', 'cercano', 'formal']),
  timezone: z.string().refine(isValidTimeZone, { message: 'invalid IANA timezone' }),
});

export const KnowledgeSchema = z.object({
  rules: z.string().max(4000).nullable(),
  prohibited: z.string().max(2000).nullable(),
  faq: FaqSchema,
  qualificationFields: z
    .array(z.enum(QUALIFICATION_FIELDS))
    .min(1)
    .refine((arr) => new Set(arr).size === arr.length, { message: 'qualificationFields must be unique' }),
});

export const LimitsSchema = z.object({
  whatsappEnabled: z.boolean(),
  voiceEnabled: z.boolean(),
  dailyTokenBudget: z.number().int().min(1_000).max(5_000_000),
  shadowMode: z.boolean(),
  maxAgentTurns: z.number().int().min(1).max(200).nullable(),
  maxActiveVisitsPerPhone: z.number().int().min(1).max(10),
  maxListingPhotos: z.number().int().min(1).max(10),
});

// ─────────────────────────────────────────────────────────────────────────────
// Never-throw parsers (deep-defaulted) — used to read agent_configs' JSONB
// columns, where a legacy/partial/corrupt stored value must never 500 a page.
// ─────────────────────────────────────────────────────────────────────────────

export function parseBusinessHours(raw: unknown): BusinessHours {
  if (raw == null || typeof raw !== 'object') return DEFAULT_BUSINESS_HOURS;
  const r = raw as Partial<BusinessHours>;

  const weeklyRaw = Array.isArray(r.weekly) ? r.weekly : DEFAULT_BUSINESS_HOURS.weekly;
  const weekly = weeklyRaw.filter((w): w is WeeklyRange => {
    const parsed = WeeklyRangeSchema.safeParse(w);
    return parsed.success;
  });

  const closedNote =
    typeof r.closedNote === 'string' ? sanitizeText(r.closedNote).slice(0, 300) || null : null;

  return { weekly: weekly.length ? weekly : DEFAULT_BUSINESS_HOURS.weekly, closedNote };
}

/** Hard clamp: 08:00-21:00 local, whatever the config says (blueprint §0.9 — never bypassable by org config). */
export function clampCallWindow(w: VoiceConfig['callWindow']): VoiceConfig['callWindow'] {
  return {
    weekdays: w.weekdays.filter((d) => d >= 1 && d <= 6),
    startMinute: Math.min(Math.max(w.startMinute, 480), 1260),
    endMinute: Math.min(Math.max(w.endMinute, 480), 1260),
  };
}

export function parseVoiceConfig(raw: unknown): VoiceConfig {
  if (raw == null || typeof raw !== 'object') return DEFAULT_VOICE_CONFIG;
  const r = raw as Partial<VoiceConfig>;

  const merged: VoiceConfig = {
    voiceProvider: r.voiceProvider && ['azure', '11labs', 'openai'].includes(r.voiceProvider) ? r.voiceProvider : DEFAULT_VOICE_CONFIG.voiceProvider,
    voiceId: typeof r.voiceId === 'string' && r.voiceId.trim() ? sanitizeText(r.voiceId).slice(0, 80) : DEFAULT_VOICE_CONFIG.voiceId,
    language: r.language && ['es', 'en', 'pt'].includes(r.language) ? r.language : DEFAULT_VOICE_CONFIG.language,
    recordingEnabled: typeof r.recordingEnabled === 'boolean' ? r.recordingEnabled : DEFAULT_VOICE_CONFIG.recordingEnabled,
    greetingExtra:
      typeof r.greetingExtra === 'string' ? sanitizeText(r.greetingExtra).slice(0, 200) || null : null,
    maxCallMinutes: clampInt(r.maxCallMinutes, 1, 30, DEFAULT_VOICE_CONFIG.maxCallMinutes),
    monthlyMinuteCap: clampInt(r.monthlyMinuteCap, 0, 100_000, DEFAULT_VOICE_CONFIG.monthlyMinuteCap),
    callWindow: clampCallWindow({
      weekdays: Array.isArray(r.callWindow?.weekdays) ? r.callWindow!.weekdays : DEFAULT_VOICE_CONFIG.callWindow.weekdays,
      startMinute: typeof r.callWindow?.startMinute === 'number' ? r.callWindow.startMinute : DEFAULT_VOICE_CONFIG.callWindow.startMinute,
      endMinute: typeof r.callWindow?.endMinute === 'number' ? r.callWindow.endMinute : DEFAULT_VOICE_CONFIG.callWindow.endMinute,
    }),
    speedToLead: {
      enabled: typeof r.speedToLead?.enabled === 'boolean' ? r.speedToLead.enabled : DEFAULT_VOICE_CONFIG.speedToLead.enabled,
      delayMinutes: clampInt(r.speedToLead?.delayMinutes, 1, 60, DEFAULT_VOICE_CONFIG.speedToLead.delayMinutes),
      sources: Array.isArray(r.speedToLead?.sources)
        ? r.speedToLead!.sources.filter((s): s is 'manual' | 'web' | 'whatsapp' => ['manual', 'web', 'whatsapp'].includes(s))
        : DEFAULT_VOICE_CONFIG.speedToLead.sources,
      staleAfterHours:
        typeof r.speedToLead?.staleAfterHours === 'number' && r.speedToLead.staleAfterHours > 0
          ? r.speedToLead.staleAfterHours
          : DEFAULT_VOICE_CONFIG.speedToLead.staleAfterHours,
    },
    visitConfirmation: {
      enabled: typeof r.visitConfirmation?.enabled === 'boolean' ? r.visitConfirmation.enabled : DEFAULT_VOICE_CONFIG.visitConfirmation.enabled,
      hoursBefore: clampInt(r.visitConfirmation?.hoursBefore, 4, 48, DEFAULT_VOICE_CONFIG.visitConfirmation.hoursBefore),
    },
    reactivation: {
      enabled: typeof r.reactivation?.enabled === 'boolean' ? r.reactivation.enabled : DEFAULT_VOICE_CONFIG.reactivation.enabled,
      coldAfterDays:
        typeof r.reactivation?.coldAfterDays === 'number' && r.reactivation.coldAfterDays > 0
          ? r.reactivation.coldAfterDays
          : DEFAULT_VOICE_CONFIG.reactivation.coldAfterDays,
      minDaysBetween:
        typeof r.reactivation?.minDaysBetween === 'number' && r.reactivation.minDaysBetween > 0
          ? r.reactivation.minDaysBetween
          : DEFAULT_VOICE_CONFIG.reactivation.minDaysBetween,
      maxPerRun: clampInt(r.reactivation?.maxPerRun, 1, 200, DEFAULT_VOICE_CONFIG.reactivation.maxPerRun),
    },
  };

  if (merged.speedToLead.sources.length === 0) merged.speedToLead.sources = ['manual'];
  return merged;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.round(v), min), max);
}

const WEEKDAY_JS_TO_SCHEMA = [0, 1, 2, 3, 4, 5, 6]; // Date#getDay(): 0=Sun..6=Sat — same convention as WeeklyRange.weekday

/** True iff `now` (in `tz`) falls inside one of `ranges`. */
export function isWithinWeeklyRanges(ranges: WeeklyRange[], now: Date, tz: string): boolean {
  const parts = zonedPartsForWeekday(now, tz);
  return ranges.some(
    (r) => r.weekday === parts.weekday && parts.minuteOfDay >= r.startMinute && parts.minuteOfDay < r.endMinute,
  );
}

/** The next UTC instant at which `now` (in `tz`) enters `w`'s window — scans at most 8 days forward. */
export function nextWindowStart(w: VoiceConfig['callWindow'], now: Date, tz: string): Date {
  const clamped = clampCallWindow(w);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const candidateDate = new Date(now.getTime() + dayOffset * 86_400_000);
    const parts = zonedPartsForWeekday(candidateDate, tz);
    if (!clamped.weekdays.includes(parts.weekday)) continue;

    const start = zonedWallTimeToUtc(parts.y, parts.m, parts.d, clamped.startMinute, tz);
    if (start > now) return start;

    // Same day, but the window already started/ended — if we're still inside it, "next start" is now;
    // otherwise keep scanning forward days.
    const end = zonedWallTimeToUtc(parts.y, parts.m, parts.d, clamped.endMinute, tz);
    if (now >= start && now < end) return now;
  }
  // Unreachable in practice (callWindow.weekdays is always non-empty after clamping upstream),
  // but never throw — fall back to "in exactly 8 days at the clamped start".
  const fallback = new Date(now.getTime() + 8 * 86_400_000);
  const parts = zonedPartsForWeekday(fallback, tz);
  return zonedWallTimeToUtc(parts.y, parts.m, parts.d, clamped.startMinute, tz);
}

// ─────────────────────────────────────────────────────────────────────────────
// Local-time helpers — mirrors src/lib/agent/visits/slots.ts's
// localDateParts/zonedWallTimeToUtc (kept independent: this module must stay
// dependency-free from the visits domain).
// ─────────────────────────────────────────────────────────────────────────────

const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedPartsForWeekday(at: Date, timeZone: string): { y: number; m: number; d: number; weekday: number; minuteOfDay: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekday = WEEKDAY_MAP[map.weekday] ?? 0;
  void WEEKDAY_JS_TO_SCHEMA; // documents the convention match; no transform needed
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    weekday,
    minuteOfDay: (Number(map.hour) % 24) * 60 + Number(map.minute),
  };
}

function zonedWallTimeToUtc(y: number, m: number, d: number, minuteOfDay: number, timeZone: string): Date {
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  const desiredMs = Date.UTC(y, m - 1, d, hh, mm, 0);

  let guessMs = desiredMs;
  for (let i = 0; i < 3; i++) {
    const parts = zonedPartsForWeekday(new Date(guessMs), timeZone);
    const actualMs = Date.UTC(parts.y, parts.m - 1, parts.d, Math.floor(parts.minuteOfDay / 60), parts.minuteOfDay % 60, 0);
    const diff = desiredMs - actualMs;
    if (diff === 0) break;
    guessMs += diff;
  }
  return new Date(guessMs);
}
