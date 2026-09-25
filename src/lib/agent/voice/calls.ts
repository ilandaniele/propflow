/**
 * agent_calls — the only write path for voice call rows, and org_channels
 * lookups for the voice channel (routing/config, mirrors widget/channel.ts's
 * web-channel pattern).
 */

import { db } from '@/lib/db';
import { agentCalls, orgChannels } from '@/lib/db/schema';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AgentCallRecord, CallDirection, CallOutcome, CallPurpose, CallStatus, VoiceChannel } from './types';

interface VoiceChannelConfig {
  phoneNumberId?: string;
  displayPhoneE164?: string | null;
}

function toCallRecord(row: typeof agentCalls.$inferSelect): AgentCallRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    sessionId: row.sessionId,
    leadId: row.leadId,
    visitId: row.visitId,
    direction: row.direction as CallDirection,
    purpose: row.purpose as CallPurpose,
    status: row.status as CallStatus,
    vapiCallId: row.vapiCallId,
    customerPhone: row.customerPhone,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    outcome: row.outcome as CallOutcome | null,
    summary: row.summary,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  };
}

function toVoiceChannel(row: typeof orgChannels.$inferSelect): VoiceChannel {
  const config = (row.config as VoiceChannelConfig) ?? {};
  return {
    orgId: row.orgId,
    channelId: row.id,
    phoneNumberId: config.phoneNumberId ?? row.externalId,
    displayPhoneE164: config.displayPhoneE164 ?? null,
  };
}

/** One indexed query — the voice webhook's hot path (assistant-request resolves the org by Vapi's phoneNumberId). */
export async function getVoiceChannelByPhoneNumberId(id: string): Promise<VoiceChannel | null> {
  const rows = await db
    .select()
    .from(orgChannels)
    .where(and(eq(orgChannels.channel, 'voice'), eq(orgChannels.externalId, id)))
    .limit(1);
  return rows[0] ? toVoiceChannel(rows[0]) : null;
}

export async function getOrgVoiceChannel(orgId: string): Promise<VoiceChannel | null> {
  const rows = await db
    .select()
    .from(orgChannels)
    .where(and(eq(orgChannels.orgId, orgId), eq(orgChannels.channel, 'voice')))
    .limit(1);
  return rows[0] ? toVoiceChannel(rows[0]) : null;
}

export interface CreateCallRowArgs {
  orgId: string;
  direction: CallDirection;
  purpose: CallPurpose;
  leadId?: string | null;
  sessionId?: string | null;
  visitId?: string | null;
  customerPhone?: string | null;
  vapiCallId?: string | null;
  phoneNumberId?: string | null;
  dedupeKey?: string | null;
  status?: CallStatus;
}

/**
 * Inserts a new agent_calls row. Returns null on a dedupe-key conflict
 * (agent_calls_dedupe) — the caller (outbound.ts's queueOutboundCall)
 * treats that as "already queued, nothing to do". A vapi_call_id conflict
 * (a race between two inbound webhook deliveries for the same call) instead
 * returns the existing row, since that race is expected and both callers
 * want the same row back.
 */
export async function createCallRow(a: CreateCallRowArgs): Promise<AgentCallRecord | null> {
  try {
    const rows = await db
      .insert(agentCalls)
      .values({
        orgId: a.orgId,
        direction: a.direction,
        purpose: a.purpose,
        leadId: a.leadId ?? null,
        sessionId: a.sessionId ?? null,
        visitId: a.visitId ?? null,
        customerPhone: a.customerPhone ?? null,
        vapiCallId: a.vapiCallId ?? null,
        phoneNumberId: a.phoneNumberId ?? null,
        dedupeKey: a.dedupeKey ?? null,
        status: a.status ?? 'queued',
      })
      // agent_calls_dedupe is a PARTIAL unique index (WHERE dedupe_key IS NOT NULL) —
      // the ON CONFLICT arbiter must repeat that predicate or Postgres won't match it.
      .onConflictDoNothing({ target: [agentCalls.orgId, agentCalls.dedupeKey], where: sql`dedupe_key IS NOT NULL` })
      .returning();

    if (rows[0]) return toCallRecord(rows[0]);
    if (!a.dedupeKey) return null; // shouldn't happen without a dedupe key, but never throw here

    // Lost the dedupe race — no new row.
    return null;
  } catch (err) {
    // vapi_call_id UNIQUE conflict — a concurrent webhook delivery for the same call already inserted it.
    const code = (err as { code?: string } | undefined)?.code;
    if (code === '23505' && a.vapiCallId) {
      return getCallByVapiId(a.vapiCallId);
    }
    throw err;
  }
}

export async function getCallById(orgId: string, id: string): Promise<AgentCallRecord | null> {
  const rows = await db.select().from(agentCalls).where(and(eq(agentCalls.orgId, orgId), eq(agentCalls.id, id))).limit(1);
  return rows[0] ? toCallRecord(rows[0]) : null;
}

export async function getCallByVapiId(vapiCallId: string): Promise<AgentCallRecord | null> {
  const rows = await db.select().from(agentCalls).where(eq(agentCalls.vapiCallId, vapiCallId)).limit(1);
  return rows[0] ? toCallRecord(rows[0]) : null;
}

export interface TransitionCallPatch {
  status?: CallStatus;
  blockReason?: string | null;
  vapiCallId?: string | null;
  sessionId?: string | null;
  leadId?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  endedReason?: string | null;
  outcome?: CallOutcome | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  summary?: string | null;
  costUsd?: string | null;
  costBreakdown?: Record<string, unknown> | null;
}

/** Conditional UPDATE ... WHERE status = ANY(from) RETURNING — null when the row isn't in one of `from`'s statuses (already transitioned, e.g. idempotent end-of-call-report handling) or doesn't exist. */
export async function transitionCall(id: string, from: CallStatus[], patch: TransitionCallPatch): Promise<AgentCallRecord | null> {
  const rows = await db
    .update(agentCalls)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(agentCalls.id, id), inArray(agentCalls.status, from)))
    .returning();
  return rows[0] ? toCallRecord(rows[0]) : null;
}

export async function countRecentCallsToLead(orgId: string, leadId: string, sinceDays: number): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db
    .select({ value: count() })
    .from(agentCalls)
    .where(and(eq(agentCalls.orgId, orgId), eq(agentCalls.leadId, leadId), gte(agentCalls.createdAt, since)));
  return rows[0]?.value ?? 0;
}
