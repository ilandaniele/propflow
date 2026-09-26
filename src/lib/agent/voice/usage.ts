/**
 * Monthly voice-minute usage (org-tz months) and the pure minute-cap check
 * the compliance gate (item C) and the inbound webhook (item B) both call.
 */

import { db } from '@/lib/db';
import { agentCalls } from '@/lib/db/schema';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { log } from '@/lib/log';
import { getOrCreateAgentConfig } from '../config';
import type { CallDirection } from './types';

/** Slack on top of an org's own maxCallMinutes before a still-"dialing"/"in_progress" row is considered stuck rather than in-flight. */
const STALE_CALL_SLACK_MINUTES = 5;

/** The first instant of `now`'s calendar month in `tz`, expressed as a UTC Date. */
function startOfMonthInTz(tz: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const y = Number(map.year);
  const m = Number(map.month);

  // Binary-search-free approach: start from UTC midnight on the 1st and nudge
  // by the timezone's offset at that instant (at most a couple of hours off,
  // corrected below by re-deriving parts — same convergence trick as
  // config-schema.ts's zonedWallTimeToUtc, simplified since we only need the day boundary).
  let guessMs = Date.UTC(y, m - 1, 1, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(guessMs));
    const m2: Record<string, string> = {};
    for (const part of p) m2[part.type] = part.value;
    const actualMs = Date.UTC(Number(m2.year), Number(m2.month) - 1, Number(m2.day), Number(m2.hour) % 24, Number(m2.minute), 0);
    const desiredMs = Date.UTC(y, m - 1, 1, 0, 0, 0);
    const diff = desiredMs - actualMs;
    if (diff === 0) break;
    guessMs += diff;
  }
  return new Date(guessMs);
}

export interface MonthlyVoiceUsage {
  usedMinutes: number;
  inFlightCalls: number;
}

/**
 * sum(ceil(duration_seconds/60)) of calls ended this org-tz month, plus the
 * count of calls currently dialing/in_progress. The in-flight count only
 * considers rows created within `maxCallMinutes` + a slack window — a call
 * stuck in 'dialing'/'in_progress' well past its own max duration is almost
 * certainly a crashed/orphaned row (failStaleCalls will fail it), not a real
 * in-flight reservation that should keep counting against the cap forever.
 */
export async function getMonthlyVoiceUsage(orgId: string, tz: string, maxCallMinutes: number, now: Date = new Date()): Promise<MonthlyVoiceUsage> {
  const monthStart = startOfMonthInTz(tz, now);
  const inFlightCutoff = new Date(now.getTime() - (maxCallMinutes + STALE_CALL_SLACK_MINUTES) * 60_000);

  const [usedRow] = await db
    .select({
      value: sql<string>`coalesce(sum(ceil(coalesce(${agentCalls.durationSeconds}, 0) / 60.0)), 0)`,
    })
    .from(agentCalls)
    .where(and(eq(agentCalls.orgId, orgId), gte(agentCalls.createdAt, monthStart)));

  const [inFlightRow] = await db
    .select({ value: sql<string>`count(*)` })
    .from(agentCalls)
    .where(and(
      eq(agentCalls.orgId, orgId),
      inArray(agentCalls.status, ['dialing', 'in_progress']),
      gte(agentCalls.createdAt, inFlightCutoff),
    ));

  return {
    usedMinutes: Number(usedRow?.value ?? 0),
    inFlightCalls: Number(inFlightRow?.value ?? 0),
  };
}

/**
 * Sweeper: marks any 'dialing'/'in_progress' row older than its org's
 * maxCallMinutes + slack as 'failed' ('stale') — a Vapi end-of-call-report
 * that never arrived (crash, dropped webhook, etc.). Called from the
 * agent-dispatch cron. Uses each org's own maxCallMinutes, so it loads every
 * distinct org with a stuck call and sweeps per-org.
 */
export async function failStaleCalls(now: Date = new Date()): Promise<number> {
  const stuck = await db
    .selectDistinct({ orgId: agentCalls.orgId })
    .from(agentCalls)
    .where(inArray(agentCalls.status, ['dialing', 'in_progress']));

  if (stuck.length === 0) return 0;

  let failed = 0;

  for (const { orgId } of stuck) {
    const config = await getOrCreateAgentConfig(orgId);
    const cutoff = new Date(now.getTime() - (config.voice.maxCallMinutes + STALE_CALL_SLACK_MINUTES) * 60_000);

    const rows = await db
      .update(agentCalls)
      .set({ status: 'failed', blockReason: 'stale', updatedAt: sql`now()` })
      .where(and(
        eq(agentCalls.orgId, orgId),
        inArray(agentCalls.status, ['dialing', 'in_progress']),
        lt(agentCalls.createdAt, cutoff),
      ))
      .returning({ id: agentCalls.id });

    if (rows.length > 0) {
      failed += rows.length;
      log.warn('[voice/usage] failStaleCalls swept stuck calls', { orgId, count: rows.length });
    }
  }

  return failed;
}

export interface CheckMinuteCapArgs {
  usedMinutes: number;
  inFlightCalls: number;
  capMinutes: number;
  maxCallMinutes: number;
  direction: CallDirection;
}

/**
 * Pure. Outbound reserves this call's max duration on top of every in-flight
 * call's reservation (worst case, so two calls dialing at once can't both
 * slip under the cap); inbound only checks the cap has room left (a live
 * inbound call's actual duration isn't known in advance, so it isn't
 * reserved) — blueprint §0.9.
 */
export function checkMinuteCap(a: CheckMinuteCapArgs): boolean {
  if (a.direction === 'outbound') {
    const reserved = a.inFlightCalls * a.maxCallMinutes;
    return a.usedMinutes + reserved + a.maxCallMinutes <= a.capMinutes;
  }
  return a.usedMinutes + a.inFlightCalls * a.maxCallMinutes < a.capMinutes;
}
