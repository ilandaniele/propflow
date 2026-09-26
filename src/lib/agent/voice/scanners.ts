/**
 * Outbound-call scanners (blueprint §5) — the actual triggers for outbound
 * voice calls. Deliberately scanners, not hooks: a lead created anywhere
 * (including a direct Drizzle insert from Phase 3-4 item D) is caught the
 * next time these run, not only on a code path that remembers to call a
 * hook. Called every ~60s from instrumentation.ts and as a cron backstop
 * (item W wires both).
 *
 * Every query is a single set-based `db.execute(sql\`...\`)` (same pattern as
 * metrics.ts, item E) with no SQL `LIMIT` — the per-org `maxPerRun` cap
 * (reactivation only) is applied in JS after the full eligible set comes
 * back, so scanners.test.ts can assert the generated SQL text never
 * contains "limit".
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { parseVoiceConfig, type VoiceConfig } from '../config-schema';
import { SYSTEM_STAGES } from '@/lib/leads/types';
import { queueOutboundCall } from './outbound';

const OPEN_STAGE_KEYS = [
  ...new Set(
    [...SYSTEM_STAGES.demand, ...SYSTEM_STAGES.supply].filter((s) => s.kind === 'open').map((s) => s.key),
  ),
];

interface EligibleConfig {
  orgId: string;
  voice: VoiceConfig;
}

/** Orgs with voice enabled and the given policy on — one query, filtered in JS since channels_enabled/voice_config are JSONB. */
async function eligibleVoiceConfigs(policy: (v: VoiceConfig) => boolean): Promise<EligibleConfig[]> {
  const rows = (await db.execute(sql`
    SELECT org_id, voice_config
    FROM agent_configs
    WHERE (channels_enabled ->> 'voice')::boolean IS TRUE
  `)) as unknown as Array<{ org_id: string; voice_config: unknown }>;

  const out: EligibleConfig[] = [];
  for (const row of rows) {
    const voice = parseVoiceConfig(row.voice_config);
    if (policy(voice)) out.push({ orgId: row.org_id, voice });
  }
  return out;
}

/**
 * Leads created in [now-60min, now-delayMinutes], source_channel in
 * `sources`, with a phone whose source_meta never marked it unverified, not
 * DNC'd, no session whose last_inbound_at is after the lead's creation (they
 * already replied — a call would be redundant), not already queued/called
 * (dedupe `stl:<leadId>`), and not older than the org's own staleAfterHours
 * cutoff.
 */
export async function scanSpeedToLead(now: Date = new Date()): Promise<number> {
  const configs = await eligibleVoiceConfigs((v) => v.speedToLead.enabled);
  let queued = 0;

  for (const { orgId, voice } of configs) {
    const hardWindowStart = new Date(now.getTime() - 60 * 60_000);
    const staleCutoff = new Date(now.getTime() - voice.speedToLead.staleAfterHours * 3_600_000);
    // The effective lower bound is whichever is more recent — the fixed
    // 60-minute scan window, or the org's own staleness cutoff (so a short
    // staleAfterHours excludes leads the fixed window would otherwise still see).
    const effectiveStart = hardWindowStart > staleCutoff ? hardWindowStart : staleCutoff;
    const windowEnd = new Date(now.getTime() - voice.speedToLead.delayMinutes * 60_000);
    if (effectiveStart >= windowEnd) continue;

    const rows = (await db.execute(sql`
      SELECT id
      FROM crm_leads
      WHERE org_id = ${orgId}
        AND created_at >= ${effectiveStart} AND created_at <= ${windowEnd}
        AND source_channel = ANY(${sql.raw(`ARRAY[${voice.speedToLead.sources.map((s) => `'${s}'`).join(',')}]`)})
        AND pipeline = 'demand'
        AND phone IS NOT NULL
        AND do_not_contact IS FALSE
        AND (source_meta ->> 'phoneVerified') IS DISTINCT FROM 'false'
        AND NOT EXISTS (SELECT 1 FROM agent_sessions s WHERE s.lead_id = crm_leads.id AND s.last_inbound_at > crm_leads.created_at)
        AND NOT EXISTS (SELECT 1 FROM agent_calls c WHERE c.org_id = crm_leads.org_id AND c.dedupe_key = 'stl:' || crm_leads.id::text)
    `)) as unknown as Array<{ id: string }>;

    for (const row of rows) {
      const id = await queueOutboundCall({ orgId, leadId: row.id, purpose: 'speed_to_lead', dedupeKey: `stl:${row.id}` });
      if (id) queued++;
    }
  }

  return queued;
}

/**
 * Scheduled visits starting between 3h and `hoursBefore` from now, created
 * over an hour ago (not a just-booked visit), whose 24h WhatsApp reminder
 * either never sent or sent over 2h ago, with a contact phone, not already
 * queued/called (dedupe `vc:<visitId>`).
 */
export async function scanVisitConfirmationCalls(now: Date = new Date()): Promise<number> {
  const configs = await eligibleVoiceConfigs((v) => v.visitConfirmation.enabled);
  let queued = 0;

  for (const { orgId, voice } of configs) {
    const from = new Date(now.getTime() + 3 * 3_600_000);
    const to = new Date(now.getTime() + voice.visitConfirmation.hoursBefore * 3_600_000);
    const createdBefore = new Date(now.getTime() - 3_600_000);
    const reminderCutoff = new Date(now.getTime() - 2 * 3_600_000);

    const rows = (await db.execute(sql`
      SELECT id, lead_id
      FROM property_visits
      WHERE org_id = ${orgId}
        AND status = 'scheduled'
        AND starts_at >= ${from} AND starts_at <= ${to}
        AND created_at < ${createdBefore}
        AND contact_phone IS NOT NULL
        AND (reminder_24h_sent_at IS NULL OR reminder_24h_sent_at < ${reminderCutoff})
        AND NOT EXISTS (SELECT 1 FROM agent_calls c WHERE c.org_id = property_visits.org_id AND c.dedupe_key = 'vc:' || property_visits.id::text)
    `)) as unknown as Array<{ id: string; lead_id: string }>;

    for (const row of rows) {
      const id = await queueOutboundCall({
        orgId,
        leadId: row.lead_id,
        purpose: 'visit_confirmation',
        visitId: row.id,
        dedupeKey: `vc:${row.id}`,
      });
      if (id) queued++;
    }
  }

  return queued;
}

/**
 * Cold demand leads in an open pipeline stage, not currently in an active
 * follow-up sequence, with a phone whose source_meta never marked it
 * unverified, no other call in the last `minDaysBetween` days, capped per
 * org at `maxPerRun` (applied in JS after the full eligible set — no SQL
 * LIMIT). Dedupe `react:<leadId>:<YYYY-MM-DD>`.
 */
export async function scanReactivationCalls(now: Date = new Date()): Promise<number> {
  const configs = await eligibleVoiceConfigs((v) => v.reactivation.enabled);
  let queued = 0;
  const dayKey = now.toISOString().slice(0, 10);

  for (const { orgId, voice } of configs) {
    const coldCutoff = new Date(now.getTime() - voice.reactivation.coldAfterDays * 86_400_000);
    const recentCallCutoff = new Date(now.getTime() - voice.reactivation.minDaysBetween * 86_400_000);
    const openStages = sql.raw(`ARRAY[${OPEN_STAGE_KEYS.map((k) => `'${k}'`).join(',')}]`);

    const rows = (await db.execute(sql`
      SELECT id
      FROM crm_leads
      WHERE org_id = ${orgId}
        AND pipeline = 'demand'
        AND stage = ANY(${openStages})
        AND do_not_contact IS FALSE
        AND phone IS NOT NULL
        AND (source_meta ->> 'phoneVerified') IS DISTINCT FROM 'false'
        AND followup_state <> 'active'
        AND (
          intent_tag = 'cold'
          OR NOT EXISTS (SELECT 1 FROM agent_sessions s WHERE s.lead_id = crm_leads.id AND s.last_inbound_at >= ${coldCutoff})
        )
        AND NOT EXISTS (SELECT 1 FROM agent_calls c WHERE c.lead_id = crm_leads.id AND c.created_at >= ${recentCallCutoff})
    `)) as unknown as Array<{ id: string }>;

    for (const row of rows.slice(0, voice.reactivation.maxPerRun)) {
      const id = await queueOutboundCall({
        orgId,
        leadId: row.id,
        purpose: 'reactivation',
        dedupeKey: `react:${row.id}:${dayKey}`,
      });
      if (id) queued++;
    }
  }

  return queued;
}
