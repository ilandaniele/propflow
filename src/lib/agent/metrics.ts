/**
 * /dashboard/agent metrics (Phase 8-9, item E). Every aggregate below runs as
 * one SQL query: a `GROUP BY channel` branch `UNION ALL` an ungrouped total
 * branch (SQLite has no GROUPING SETS) — the grouped rows feed
 * `byChannel.whatsapp/web/voice`, and the single `is_total = 1` row is the true
 * org-wide total (`byChannel.all`), computed by the database in the SAME query
 * rather than summed in JS. There is never a `LIMIT` before
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
 * channel column value + `is_total` flag -> the bucket key it feeds, or null.
 * `is_total = 1` marks the ungrouped total branch of the `UNION ALL` rollup —
 * that's the only row that belongs in `all`. A `channel IS NULL` row that ISN'T the rollup (a real
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

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Same as Postgres' `percentile_cont`: linear interpolation over ascending-sorted values. */
export function percentileCont(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
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
  const fromMs = r.from.getTime();
  const toMs = r.to.getTime();
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
    WITH s AS (
      SELECT channel FROM agent_sessions
      WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs}
        AND external_id NOT LIKE 'playground:%'
    )
    SELECT channel, COUNT(*) AS n, 0 AS is_total FROM s GROUP BY channel
    UNION ALL
    SELECT NULL, COUNT(*), 1 FROM s
  `)) as unknown as Array<{ channel: string | null; n: unknown; is_total: unknown }>;
  for (const row of conversationRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) byChannel[bucket].conversations = toNum(row.n);
  }

  // ── leads / qualified (crm_leads, by source_channel) ──────────────────────
  const leadRows = (await db.execute(sql`
    WITH l AS (
      SELECT source_channel AS channel,
        COALESCE(intent_tag IN ('qualified', 'high_intent')
          OR stage IN ('qualified', 'visit_scheduled', 'visited', 'negotiating', 'won'), 0) AS is_qualified
      FROM crm_leads
      WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs}
    )
    SELECT channel, COUNT(*) AS n, SUM(is_qualified) AS qualified, 0 AS is_total FROM l GROUP BY channel
    UNION ALL
    SELECT NULL, COUNT(*), SUM(is_qualified), 1 FROM l
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
    WITH v AS (
      SELECT source_channel AS channel, lead_id,
        (created_at >= ${fromMs} AND created_at < ${toMs} AND status <> 'rescheduled') AS is_booked,
        (starts_at >= ${fromMs} AND starts_at < ${toMs} AND status = 'completed') AS is_completed,
        (starts_at >= ${fromMs} AND starts_at < ${toMs} AND status = 'no_show') AS is_no_show
      FROM property_visits
      WHERE org_id = ${orgId}
        AND ((created_at >= ${fromMs} AND created_at < ${toMs}) OR (starts_at >= ${fromMs} AND starts_at < ${toMs}))
    )
    SELECT channel, SUM(is_booked) AS booked, SUM(is_completed) AS completed, SUM(is_no_show) AS no_show,
      COUNT(DISTINCT CASE WHEN is_booked THEN lead_id END) AS visited_leads, 0 AS is_total
    FROM v GROUP BY channel
    UNION ALL
    SELECT NULL, SUM(is_booked), SUM(is_completed), SUM(is_no_show), COUNT(DISTINCT CASE WHEN is_booked THEN lead_id END), 1
    FROM v
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
    WITH h AS (
      SELECT DISTINCT s.id, s.channel
      FROM agent_sessions s
      JOIN agent_events e ON e.session_id = s.id
      WHERE s.org_id = ${orgId} AND s.created_at >= ${fromMs} AND s.created_at < ${toMs}
        AND s.external_id NOT LIKE 'playground:%'
        AND (e.kind = 'handoff' OR (e.kind = 'mode_change' AND json_extract(e.data, '$.to') = 'human'))
    )
    SELECT channel, COUNT(*) AS handoffs, 0 AS is_total FROM h GROUP BY channel
    UNION ALL
    SELECT NULL, COUNT(*), 1 FROM h
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
    WITH c AS (
      SELECT s.channel AS channel,
        COALESCE(
          CAST(am.cost_usd AS REAL),
          (COALESCE(am.input_tokens, 0) * ${COST_SQL_RATES.inPerMtok} / 1000000.0)
            + (COALESCE(am.output_tokens, 0) * ${COST_SQL_RATES.outPerMtok} / 1000000.0)
        ) AS cost
      FROM agent_messages am
      JOIN agent_sessions s ON s.id = am.session_id
      WHERE am.org_id = ${orgId} AND am.created_at >= ${fromMs} AND am.created_at < ${toMs}
        AND s.external_id NOT LIKE 'playground:%'
    )
    SELECT channel, SUM(cost) AS cost, 0 AS is_total FROM c GROUP BY channel
    UNION ALL
    SELECT NULL, SUM(cost), 1 FROM c
  `)) as unknown as Array<{ channel: string | null; cost: unknown; is_total: unknown }>;
  for (const row of costRows) {
    const bucket = bucketForRow(row.channel, row.is_total);
    if (bucket) byChannel[bucket].aiCostUsd += toNum(row.cost);
  }

  // ── voice calls: count/outcome/minutes/cost (agent_calls is voice-only —
  //    voice turns never run through runAgentTurn / agent_messages) ─────────
  const callRows = (await db.execute(sql`
    SELECT COUNT(*) AS calls,
      COALESCE(SUM(outcome = 'answered'), 0) AS answered,
      COALESCE(SUM((duration_seconds + 59) / 60), 0) AS minutes,
      COALESCE(SUM(CAST(cost_usd AS REAL)), 0) AS cost
    FROM agent_calls
    WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs}
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
      WHERE org_id = ${orgId} AND channel = 'whatsapp' AND created_at >= ${fromMs} AND created_at < ${toMs}
        AND external_id NOT LIKE 'playground:%' AND whatsapp_conversation_id IS NOT NULL
    ),
    wa_first_in AS (
      SELECT conversation_id, MIN(created_at) AS in_at
      FROM whatsapp_messages
      WHERE conversation_id IN (SELECT conv_id FROM wa_sessions) AND direction = 'inbound'
      GROUP BY conversation_id
    ),
    wa_first_out AS (
      SELECT wm.conversation_id, MIN(wm.created_at) AS out_at
      FROM whatsapp_messages wm
      JOIN wa_first_in fi ON fi.conversation_id = wm.conversation_id
      WHERE wm.direction = 'outbound' AND wm.sender_kind IN ('agent', 'human') AND wm.created_at > fi.in_at
      GROUP BY wm.conversation_id
    ),
    web_sessions AS (
      SELECT id
      FROM agent_sessions
      WHERE org_id = ${orgId} AND channel = 'web' AND created_at >= ${fromMs} AND created_at < ${toMs}
        AND external_id NOT LIKE 'playground:%'
    ),
    web_first_user AS (
      SELECT session_id, MIN(created_at) AS u_at
      FROM agent_messages
      WHERE session_id IN (SELECT id FROM web_sessions) AND role = 'user'
      GROUP BY session_id
    ),
    web_first_assistant AS (
      SELECT am.session_id, MIN(am.created_at) AS a_at
      FROM agent_messages am
      JOIN web_first_user fu ON fu.session_id = am.session_id
      WHERE am.role = 'assistant' AND am.send_status = 'sent' AND am.created_at > fu.u_at
      GROUP BY am.session_id
    )
    SELECT 'whatsapp' AS channel, (fo.out_at - fi.in_at) / 1000.0 AS delta_sec
    FROM wa_first_in fi JOIN wa_first_out fo ON fo.conversation_id = fi.conversation_id
    UNION ALL
    SELECT 'web' AS channel, (fa.a_at - fu.u_at) / 1000.0 AS delta_sec
    FROM web_first_user fu JOIN web_first_assistant fa ON fa.session_id = fu.session_id
  `)) as unknown as Array<{ channel: string; delta_sec: unknown }>;
  const deltasByBucket: Partial<Record<MetricsChannel, number[]>> = {};
  for (const row of firstResponseRows) {
    const bucket = bucketForRow(row.channel, 0);
    if (!bucket) continue;
    const delta = toNum(row.delta_sec);
    (deltasByBucket[bucket] ??= []).push(delta);
    (deltasByBucket.all ??= []).push(delta);
  }
  for (const [bucket, deltas] of Object.entries(deltasByBucket) as Array<[MetricsChannel, number[]]>) {
    deltas.sort((a, b) => a - b);
    byChannel[bucket].firstResponseP50Sec = percentileCont(deltas, 0.5);
    byChannel[bucket].firstResponseP90Sec = percentileCont(deltas, 0.9);
  }

  // ── derived per-channel ratios that need the totals computed above ────────
  for (const bucket of [...CHANNELS, 'all'] as const) {
    const m = byChannel[bucket];
    m.costPerConversation = ratio(m.aiCostUsd, m.conversations);
    m.costPerVisit = ratio(m.aiCostUsd, m.visitsBooked);
    m.leadToVisitRate = ratio(visitedLeadsByBucket[bucket] ?? 0, m.leads);
  }

  const daily = await getDailySeries(orgId, r.from, r.to, tz);

  return {
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    timezone: tz,
    byChannel,
    daily,
  };
}

/**
 * Daily counts are pre-aggregated in SQL into 15-minute UTC slots (every real
 * timezone offset is a multiple of 15 minutes, so a slot never straddles a
 * local midnight) and folded into local calendar days in JS.
 */
const SLOT_MS = 15 * 60 * 1000;

type SlotRow = { slot: unknown; n: unknown };

function formatDay(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function countByLocalDay(rows: SlotRow[], tz: string): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const { y, m, d } = localDateParts(new Date(toNum(row.slot) * SLOT_MS), tz);
    const day = formatDay(y, m, d);
    byDay.set(day, (byDay.get(day) ?? 0) + toNum(row.n));
  }
  return byDay;
}

async function getDailySeries(
  orgId: string,
  from: Date,
  to: Date,
  tz: string,
): Promise<Array<{ day: string; conversations: number; leads: number; visitsBooked: number }>> {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const [sessionRows, leadRows, visitRows] = await Promise.all([
    db.execute(sql`
      SELECT created_at / ${SLOT_MS} AS slot, COUNT(*) AS n
      FROM agent_sessions
      WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs}
        AND external_id NOT LIKE 'playground:%'
      GROUP BY slot
    `) as unknown as Promise<SlotRow[]>,
    db.execute(sql`
      SELECT created_at / ${SLOT_MS} AS slot, COUNT(*) AS n
      FROM crm_leads
      WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs}
      GROUP BY slot
    `) as unknown as Promise<SlotRow[]>,
    db.execute(sql`
      SELECT created_at / ${SLOT_MS} AS slot, COUNT(*) AS n
      FROM property_visits
      WHERE org_id = ${orgId} AND created_at >= ${fromMs} AND created_at < ${toMs} AND status <> 'rescheduled'
      GROUP BY slot
    `) as unknown as Promise<SlotRow[]>,
  ]);

  const conversationsByDay = countByLocalDay(sessionRows, tz);
  const leadsByDay = countByLocalDay(leadRows, tz);
  const visitsByDay = countByLocalDay(visitRows, tz);

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
    days.push(formatDay(y, m, d));
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
