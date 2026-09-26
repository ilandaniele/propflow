/**
 * Outbound compliance gate (blueprint §0.9) — re-run right before every dial
 * (outbound.ts's runOutboundCallJob), never trusted from queue time alone.
 * `decideOutboundCall` is pure so compliance.test.ts can exhaustively cover
 * the check order without touching the DB; `evaluateOutboundCall` gathers
 * the inputs for a given agent_calls row.
 */

import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateAgentConfig } from '../config';
import { getVisit } from '../visits/service';
import { ACTIVE_VISIT_STATUSES } from '../visits/types';
import { isWithinWeeklyRanges, clampCallWindow, type VoiceConfig, type WeeklyRange } from '../config-schema';
import { getOrgVoiceChannel } from './calls';
import { isOnDoNotCallList } from './dnc';
import { checkMinuteCap, getMonthlyVoiceUsage } from './usage';
import type { AgentCallRecord } from './types';

export type CallBlockReason =
  | 'voice_disabled'
  | 'no_number'
  | 'dnc'
  | 'do_not_contact'
  | 'unverified_phone'
  | 'outside_hours'
  | 'minute_cap'
  | 'stale'
  | 'visit_inactive';

export type OutboundCallDecision = { action: 'dial' } | { action: 'defer' } | { action: 'block'; reason: CallBlockReason };

export interface DecideOutboundCallInput {
  voiceEnabled: boolean;
  hasNumber: boolean;
  onDnc: boolean;
  doNotContact: boolean;
  phoneVerified: boolean;
  withinWindow: boolean;
  capOk: boolean;
  stale: boolean;
  visitActive: boolean | null;
}

/**
 * Pure. Checked in exactly this order — the first failing check wins.
 * `outside_hours` is the only 'defer' (the job re-enqueues at the next
 * window start); everything else is a terminal 'block'.
 */
export function decideOutboundCall(i: DecideOutboundCallInput): OutboundCallDecision {
  if (!i.voiceEnabled) return { action: 'block', reason: 'voice_disabled' };
  if (!i.hasNumber) return { action: 'block', reason: 'no_number' };
  if (i.onDnc) return { action: 'block', reason: 'dnc' };
  if (i.doNotContact) return { action: 'block', reason: 'do_not_contact' };
  if (!i.phoneVerified) return { action: 'block', reason: 'unverified_phone' };
  if (!i.withinWindow) return { action: 'defer' };
  if (!i.capOk) return { action: 'block', reason: 'minute_cap' };
  if (i.stale) return { action: 'block', reason: 'stale' };
  if (i.visitActive === false) return { action: 'block', reason: 'visit_inactive' };
  return { action: 'dial' };
}

/** `callWindow` applies the same [startMinute, endMinute) range to every listed weekday. */
function callWindowToWeeklyRanges(w: VoiceConfig['callWindow']): WeeklyRange[] {
  const clamped = clampCallWindow(w);
  return clamped.weekdays.map((weekday) => ({ weekday, startMinute: clamped.startMinute, endMinute: clamped.endMinute }));
}

interface LeadComplianceFields {
  phone: string | null;
  doNotContact: boolean;
  sourceMeta: Record<string, unknown> | null;
}

async function loadLeadComplianceFields(orgId: string, leadId: string): Promise<LeadComplianceFields | null> {
  const rows = await db
    .select({ phone: crmLeads.phone, doNotContact: crmLeads.doNotContact, sourceMeta: crmLeads.sourceMeta })
    .from(crmLeads)
    .where(and(eq(crmLeads.orgId, orgId), eq(crmLeads.id, leadId)))
    .limit(1);
  return rows[0]
    ? { phone: rows[0].phone, doNotContact: rows[0].doNotContact, sourceMeta: (rows[0].sourceMeta as Record<string, unknown>) ?? null }
    : null;
}

/** Never automated-call a phone the lead's own source_meta explicitly marked unverified (Phase 7 rule). Missing phone/lead is also unverified (fail closed). */
function isPhoneVerified(fields: LeadComplianceFields | null): boolean {
  if (!fields?.phone) return false;
  return fields.sourceMeta?.phoneVerified !== false;
}

export async function evaluateOutboundCall(call: AgentCallRecord, now: Date = new Date()): Promise<OutboundCallDecision> {
  const config = await getOrCreateAgentConfig(call.orgId);
  const voiceChannel = await getOrgVoiceChannel(call.orgId);
  const leadFields = call.leadId ? await loadLeadComplianceFields(call.orgId, call.leadId) : null;
  const phone = call.customerPhone ?? leadFields?.phone ?? null;

  const [onDnc, usage, visitActive] = await Promise.all([
    phone ? isOnDoNotCallList(call.orgId, phone) : Promise.resolve(false),
    getMonthlyVoiceUsage(call.orgId, config.timezone, config.voice.maxCallMinutes, now),
    call.purpose === 'visit_confirmation' && call.visitId ? isVisitStillActive(call.orgId, call.visitId) : Promise.resolve(null),
  ]);

  const capOk = checkMinuteCap({
    usedMinutes: usage.usedMinutes,
    inFlightCalls: usage.inFlightCalls,
    capMinutes: config.voice.monthlyMinuteCap,
    maxCallMinutes: config.voice.maxCallMinutes,
    direction: 'outbound',
  });

  const stale =
    call.purpose === 'speed_to_lead' &&
    now.getTime() - call.createdAt.getTime() > config.voice.speedToLead.staleAfterHours * 3_600_000;

  return decideOutboundCall({
    voiceEnabled: config.channelsEnabled.voice,
    hasNumber: Boolean(voiceChannel),
    onDnc,
    doNotContact: leadFields?.doNotContact ?? false,
    phoneVerified: isPhoneVerified(leadFields ?? (phone ? { phone, doNotContact: false, sourceMeta: null } : null)),
    withinWindow: isWithinWeeklyRanges(callWindowToWeeklyRanges(config.voice.callWindow), now, config.timezone),
    capOk,
    stale,
    visitActive,
  });
}

async function isVisitStillActive(orgId: string, visitId: string): Promise<boolean> {
  const visit = await getVisit(orgId, visitId);
  return visit != null && (ACTIVE_VISIT_STATUSES as readonly string[]).includes(visit.status);
}
