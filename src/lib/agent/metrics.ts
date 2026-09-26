/**
 * /dashboard/agent metrics (Phase 8-9, item E). Every aggregate below runs as
 * one SQL query with `GROUP BY GROUPING SETS ((channel), ())` — the grouped
 * rows feed `byChannel.whatsapp/web/voice`, and the single `channel IS NULL`
 * row is the true org-wide total (`byChannel.all`), computed by Postgres in
 * the SAME query rather than summed in JS. There is never a `LIMIT` before
 * an aggregate. Playground sessions (`external_id LIKE 'playground:%'`) are
 * excluded everywhere a session is involved; playground turns are always
 * `dryRun` (src/app/actions/agent-playground.ts), so they never create
 * crm_leads/property_visits rows in the first place.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { getOrCreateAgentConfig } from './config';
import { COST_SQL_RATES } from './pricing';
import { localDateParts, zonedWallTimeToUtc } from './visits/slots';

export type MetricsChannel = 'whatsapp' | 'web' | 'voice' | 'all';

const CHANNELS: ReadonlyArray<Exclude<MetricsChannel, 'all'>> = ['whatsapp', 'web', 'voice'];

export interface ChannelMetrics {
  conversations: number;
  leads: number;
  qualifiedLeads: number;
  visitsBooked: number;
  visitsCompleted: number;
  visitsNoShow: number;
  leadToVisitRate: number | null;
  firstResponseP50Sec: number | null;
  firstResponseP90Sec: number | null;
  handoffs: number;
  handoffRate: number | null;
  aiCostUsd: number;
  costPerConversation: number | null;
  costPerVisit: number | null;
  calls: number;
  answeredCalls: number;
  voiceMinutes: number;
}

export interface AgentMetrics {
  from: string;
  to: string;
  timezone: string;
  byChannel: Record<MetricsChannel, ChannelMetrics>;
  daily: Array<{ day: string; conversations: number; leads: number; visitsBooked: number }>;
}

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const MAX_CUSTOM_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * `range`: '7d'|'30d'|'90d' (default) or 'custom' with `from`/`to` (YYYY-MM-DD,
 * inclusive, interpreted in the org's timezone). Custom ranges are clamped to
 * at most 366 days; anything unparseable falls back to the 30d default.
 */
export function resolveRange(
  sp: { range?: string; from?: string; to?: string },
  tz: string,
  now: Date = new Date(),
): { from: Date; to: Date } {
  if (sp.range === 'custom' && sp.from && sp.to) {
    const fromParts = parseDateOnly(sp.from);
    const toParts = parseDateOnly(sp.to);
    if (fromParts && toParts) {
      try {
        const from = zonedWallTimeToUtc(fromParts.y, fromParts.m, fromParts.d, 0, tz);
        // Exclusive upper bound: local midnight of the day AFTER `to` (so `to` itself is included whole).
        const dayAfterTo = new Date(Date.UTC(toParts.y, toParts.m - 1, toParts.d + 1));
        const to = zonedWallTimeToUtc(dayAfterTo.getUTCFullYear(), dayAfterTo.getUTCMonth() + 1, dayAfterTo.getUTCDate(), 0, tz);
        if (to.getTime() > from.getTime()) {
          const maxTo = new Date(from.getTime() + MAX_CUSTOM_RANGE_DAYS * DAY_MS);
          return { from, to: to.getTime() > maxTo.getTime() ? maxTo : to };
        }
      } catch {
        // invalid timezone or Intl failure — fall through to the default range below.
      }
    }
  }

  const days = RANGE_DAYS[sp.range ?? '30d'] ?? 30;
  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);
  return { from, to };
}

function emptyChannelMetrics(): ChannelMetrics {
  return {
    conversations: 0,
    leads: 0,
    qualifiedLeads: 0,
    visitsBooked: 0,
    visitsCompleted: 0,
    visitsNoShow: 0,
    leadToVisitRate: null,
    firstResponseP50Sec: null,
    firstResponseP90Sec: null,
    handoffs: 0,
    handoffRate: null,
    aiCostUsd: 0,
    costPerConversation: null,
    costPerVisit: null,
    calls: 0,
    answeredCalls: 0,
    voiceMinutes: 0,
  };
}

function emptyByChannel(): Record<MetricsChannel, ChannelMetrics> {
  return { whatsapp: emptyChannelMetrics(), web: emptyChannelMetrics(), voice: emptyChannelMetrics(), all: emptyChannelMetrics() };
}

/**
 * channel column value + Postgres' `GROUPING(col)` flag -> the bucket key it
 * feeds, or null. `GROUPING(col) = 1` marks the `()` rollup row of a
 * `GROUP BY GROUPING SETS ((col), ())` query — that's the only row that
 * belongs in `all`. A `channel IS NULL` row that ISN'T the rollup (a real
 * row whose channel column is genuinely NULL/unknown) is dropped instead of
 * being mistaken for the total, which `channel === null` alone can't tell
 * apart.
 */
function bucketForRow(channel: string | null, isTotal: unknown): MetricsChannel | null {
  if (toNum(isTotal) === 1) return 'all';
  if (channel === null) return null;
  return (CHANNELS as readonly string[]).includes(channel) ? (channel as MetricsChannel) : null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * A stored org timezone can be empty/garbage (hand-edited config, a stale
 * default, etc.) — `AT TIME ZONE <bad tz>` throws inside Postgres, which
 * would 500 the whole metrics page. Validate once via Intl (same check
 * config-schema.ts's IdentitySchema uses) and fall back to 'UTC' before it
 * ever reaches resolveRange or getDailySeries.
 */
export function safeTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export async function getAgentMetrics(orgId: string, r: { from: Date; to: Date }): Promise<AgentMetrics> {
  const { from, to } = r;
  const config = await getOrCreateAgentConfig(orgId);
  const tz = safeTimezone(config.timezone);

  const byChannel = emptyByChannel();
  // Populated from visitRows below, consumed by the derived-ratios loop —
  // leadToVisitRate must be computed there (once leads totals are final for
  // every bucket) rather than inline, so a bucket with visited leads but no
  // separately-reported leads row (or vice versa) still gets ratio(0, leads).
  const visitedLeadsByBucket: Partial<Record<MetricsChannel, number>> = {};

  // ── conversations (agent_sessions, excluding playground) ─────────────────
  const conversationRows = (await db.execute(sql`
    SELECT channel, COUNT(*) AS n, GROUPING(channel) AS is_total
    FROM agent_sessions
    WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
      AND external_id NOT LIKE 'playground:%'
    GROUP BY GROUPING SETS ((channel), ())
  `)) as unknown as Array<{ channel: string | null; n: unknown; is_total: unknown }>;
  for (const row of conversationRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) byChannel[bucket].conversations = toNum(row.n);
  }

  // ── leads / qualified (crm_leads, by source_channel) ──────────────────────
  const leadRows = (await db.execute(sql`
    SELECT source_channel AS channel, COUNT(*) AS n,
      COUNT(*) FILTER (
        WHERE intent_tag IN ('qualified', 'high_intent')
           OR stage IN ('qualified', 'visit_scheduled', 'visited', 'negotiating', 'won')
      ) AS qualified,
      GROUPING(source_channel) AS is_total
    FROM crm_leads
    WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
    GROUP BY GROUPING SETS ((source_channel), ())
  `)) as unknown as Array<{ channel: string | null; n: unknown; qualified: unknown; is_total: unknown }>;
  for (const row of leadRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) {
      byChannel[bucket].leads = toNum(row.n);
      byChannel[bucket].qualifiedLeads = toNum(row.qualified);
    }
  }

  // ── visits: booked (by created_at), completed/no_show (by starts_at), plus
  //    the conversion-cohort numerator (distinct booked leads) ─────────────
  const visitRows = (await db.execute(sql`
    SELECT source_channel AS channel,
      COUNT(*) FILTER (WHERE created_at >= ${from} AND created_at < ${to} AND status <> 'rescheduled') AS booked,
      COUNT(*) FILTER (WHERE starts_at >= ${from} AND starts_at < ${to} AND status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE starts_at >= ${from} AND starts_at < ${to} AND status = 'no_show') AS no_show,
      COUNT(DISTINCT lead_id) FILTER (WHERE created_at >= ${from} AND created_at < ${to} AND status <> 'rescheduled') AS visited_leads,
      GROUPING(source_channel) AS is_total
    FROM property_visits
    WHERE org_id = ${orgId}
      AND ((created_at >= ${from} AND created_at < ${to}) OR (starts_at >= ${from} AND starts_at < ${to}))
    GROUP BY GROUPING SETS ((source_channel), ())
  `)) as unknown as Array<{ channel: string | null; booked: unknown; completed: unknown; no_show: unknown; visited_leads: unknown; is_total: unknown }>;
  for (const row of visitRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) {
      byChannel[bucket].visitsBooked = toNum(row.booked);
      byChannel[bucket].visitsCompleted = toNum(row.completed);
      byChannel[bucket].visitsNoShow = toNum(row.no_show);
      visitedLeadsByBucket[bucket] = toNum(row.visited_leads);
    }
  }

  // ── handoffs (agent_events linked to sessions in range) ───────────────────
  const handoffRows = (await db.execute(sql`
    SELECT s.channel AS channel, COUNT(DISTINCT s.id) AS handoffs, GROUPING(s.channel) AS is_total
    FROM agent_sessions s
    JOIN agent_events e ON e.session_id = s.id
    WHERE s.org_id = ${orgId} AND s.created_at >= ${from} AND s.created_at < ${to}
      AND s.external_id NOT LIKE 'playground:%'
      AND (e.kind = 'handoff' OR (e.kind = 'mode_change' AND e.data ->> 'to' = 'human'))
    GROUP BY GROUPING SETS ((s.channel), ())
  `)) as unknown as Array<{ channel: string | null; handoffs: unknown; is_total: unknown }>;
  for (const row of handoffRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) {
      byChannel[bucket].handoffs = toNum(row.handoffs);
      byChannel[bucket].handoffRate = ratio(byChannel[bucket].handoffs, byChannel[bucket].conversations);
    }
  }

  // ── AI cost from agent_messages (legacy NULL cost_usd rows estimated from
  //    tokens at COST_SQL_RATES, per pricing.ts) ────────────────────────────
  const costRows = (await db.execute(sql`
    SELECT s.channel AS channel,
      SUM(COALESCE(
        am.cost_usd,
        (COALESCE(am.input_tokens, 0) * ${COST_SQL_RATES.inPerMtok} / 1000000.0)
          + (COALESCE(am.output_tokens, 0) * ${COST_SQL_RATES.outPerMtok} / 1000000.0)
      )) AS cost,
      GROUPING(s.channel) AS is_total
    FROM agent_messages am
    JOIN agent_sessions s ON s.id = am.session_id
    WHERE am.org_id = ${orgId} AND am.created_at >= ${from} AND am.created_at < ${to}
      AND s.external_id NOT LIKE 'playground:%'
    GROUP BY GROUPING SETS ((s.channel), ())
  `)) as unknown as Array<{ channel: string | null; cost: unknown; is_total: unknown }>;
  for (const row of costRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) byChannel[bucket].aiCostUsd += toNum(row.cost);
  }

  // ── voice calls: count/outcome/minutes/cost (agent_calls is voice-only —
  //    voice turns never run through runAgentTurn / agent_messages) ─────────
  const callRows = (await db.execute(sql`
    SELECT COUNT(*) AS calls,
      COUNT(*) FILTER (WHERE outcome = 'answered') AS answered,
      COALESCE(SUM(CEIL(duration_seconds / 60.0)), 0) AS minutes,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM agent_calls
    WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
  `)) as unknown as Array<{ calls: unknown; answered: unknown; minutes: unknown; cost: unknown }>;
  const callTotals = callRows[0];
  if (callTotals) {
    byChannel.voice.calls = toNum(callTotals.calls);
    byChannel.voice.answeredCalls = toNum(callTotals.answered);
    byChannel.voice.voiceMinutes = toNum(callTotals.minutes);
    byChannel.voice.aiCostUsd += toNum(callTotals.cost);
    byChannel.all.calls += byChannel.voice.calls;
    byChannel.all.answeredCalls += byChannel.voice.answeredCalls;
    byChannel.all.voiceMinutes += byChannel.voice.voiceMinutes;
    byChannel.all.aiCostUsd += toNum(callTotals.cost);
  }

  // ── first response time: WhatsApp (whatsapp_messages) and web
  //    (agent_messages), pooled together for the 'all' bucket. Voice stays
  //    null — there is no per-message timing on a live call. ────────────────
  const firstResponseRows = (await db.execute(sql`
    WITH wa_sessions AS (
      SELECT id, whatsapp_conversation_id AS conv_id
      FROM agent_sessions
      WHERE org_id = ${orgId} AND channel = 'whatsapp' AND created_at >= ${from} AND created_at < ${to}
        AND external_id NOT LIKE 'playground:%' AND whatsapp_conversation_id IS NOT NULL
    ),
    wa_first_in AS (
      SELECT DISTINCT ON (conversation_id) conversation_id, created_at AS in_at
      FROM whatsapp_messages
      WHERE conversation_id IN (SELECT conv_id FROM wa_sessions) AND direction = 'inbound'
      ORDER BY conversation_id, created_at ASC
    ),
    wa_first_out AS (
      SELECT DISTINCT ON (wm.conversation_id) wm.conversation_id, wm.created_at AS out_at
      FROM whatsapp_messages wm
      JOIN wa_first_in fi ON fi.conversation_id = wm.conversation_id
      WHERE wm.direction = 'outbound' AND wm.sender_kind IN ('agent', 'human') AND wm.created_at > fi.in_at
      ORDER BY wm.conversation_id, wm.created_at ASC
    ),
    web_sessions AS (
      SELECT id
      FROM agent_sessions
      WHERE org_id = ${orgId} AND channel = 'web' AND created_at >= ${from} AND created_at < ${to}
        AND external_id NOT LIKE 'playground:%'
    ),
    web_first_user AS (
      SELECT DISTINCT ON (session_id) session_id, created_at AS u_at
      FROM agent_messages
      WHERE session_id IN (SELECT id FROM web_sessions) AND role = 'user'
      ORDER BY session_id, created_at ASC
    ),
    web_first_assistant AS (
      SELECT DISTINCT ON (am.session_id) am.session_id, am.created_at AS a_at
      FROM agent_messages am
      JOIN web_first_user fu ON fu.session_id = am.session_id
      WHERE am.role = 'assistant' AND am.send_status = 'sent' AND am.created_at > fu.u_at
      ORDER BY am.session_id, am.created_at ASC
    ),
    deltas AS (
      SELECT 'whatsapp'::text AS channel, EXTRACT(EPOCH FROM (fo.out_at - fi.in_at)) AS delta_sec
      FROM wa_first_in fi JOIN wa_first_out fo ON fo.conversation_id = fi.conversation_id
      UNION ALL
      SELECT 'web'::text AS channel, EXTRACT(EPOCH FROM (fa.a_at - fu.u_at)) AS delta_sec
      FROM web_first_user fu JOIN web_first_assistant fa ON fa.session_id = fu.session_id
    )
    SELECT channel, percentile_cont(0.5) WITHIN GROUP (ORDER BY delta_sec) AS p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY delta_sec) AS p90,
      GROUPING(channel) AS is_total
    FROM deltas
    GROUP BY GROUPING SETS ((channel), ())
  `)) as unknown as Array<{ channel: string | null; p50: unknown; p90: unknown; is_total: unknown }>;
  for (const row of firstResponseRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) {
      byChannel[bucket].firstResponseP50Sec = toNumOrNull(row.p50);
      byChannel[bucket].firstResponseP90Sec = toNumOrNull(row.p90);
    }
  }

  // ── derived per-channel ratios that need the totals computed above ────────
  for (const bucket of [...CHANNELS, 'all'] as const) {
    const m = byChannel[bucket];
    m.costPerConversation = ratio(m.aiCostUsd, m.conversations);
    m.costPerVisit = ratio(m.aiCostUsd, m.visitsBooked);
    m.leadToVisitRate = ratio(visitedLeadsByBucket[bucket] ?? 0, m.leads);
  }

  const daily = await getDailySeries(orgId, from, to, tz);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: tz,
    byChannel,
    daily,
  };
}

async function getDailySeries(
  orgId: string,
  from: Date,
  to: Date,
  tz: string,
): Promise<Array<{ day: string; conversations: number; leads: number; visitsBooked: number }>> {
  const [sessionRows, leadRows, visitRows] = await Promise.all([
    db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM agent_sessions
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
        AND external_id NOT LIKE 'playground:%'
      GROUP BY day
    `) as unknown as Promise<Array<{ day: Date | string; n: unknown }>>,
    db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM crm_leads
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to}
      GROUP BY day
    `) as unknown as Promise<Array<{ day: Date | string; n: unknown }>>,
    db.execute(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM property_visits
      WHERE org_id = ${orgId} AND created_at >= ${from} AND created_at < ${to} AND status <> 'rescheduled'
      GROUP BY day
    `) as unknown as Promise<Array<{ day: Date | string; n: unknown }>>,
  ]);

  // `to_char` already returns a plain string, but postgres.js can still hand
  // back a JS Date for date/timestamp-typed columns depending on the driver
  // path — accept both defensively instead of assuming `.slice` exists.
  const dayKey = (v: Date | string): string => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  const conversationsByDay = new Map(sessionRows.map((r) => [dayKey(r.day), toNum(r.n)]));
  const leadsByDay = new Map(leadRows.map((r) => [dayKey(r.day), toNum(r.n)]));
  const visitsByDay = new Map(visitRows.map((r) => [dayKey(r.day), toNum(r.n)]));

  // Step by calendar day (not by a fixed 24h) so DST-shifted days in `tz` are
  // neither skipped nor duplicated.
  const days: string[] = [];
  const start = localDateParts(from, tz);
  let y = start.y;
  let m = start.m;
  let d = start.d;
  for (let i = 0; i < MAX_CUSTOM_RANGE_DAYS + 1; i++) {
    const dayStart = zonedWallTimeToUtc(y, m, d, 0, tz);
    if (dayStart.getTime() >= to.getTime()) break;
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }

  return days.map((day) => ({
    day,
    conversations: conversationsByDay.get(day) ?? 0,
    leads: leadsByDay.get(day) ?? 0,
    visitsBooked: visitsByDay.get(day) ?? 0,
  }));
}
