/**
 * Pure follow-up scheduling logic (Phase 6, item E, blueprint §6). No DB
 * access here — followups.ts is the only caller and owns persistence, so
 * this file is trivially unit-testable and shares its date-math helpers
 * with visits/slots.ts instead of re-deriving timezone conversion.
 */

import { localDateParts, zonedWallTimeToUtc } from '@/lib/agent/visits/slots';
import type { FollowupPolicy, FollowupStopReason, StageKind } from './types';

export interface SendWindow {
  startMinute: number;
  endMinute: number;
}

/**
 * Shifts `at` into the org-local send window [startMinute, endMinute):
 * already inside → unchanged; before the window opens → same local day at
 * startMinute; at/after the window closes → next local day at startMinute.
 */
export function shiftIntoSendWindow(at: Date, w: SendWindow, timeZone: string): Date {
  const parts = localDateParts(at, timeZone);
  if (parts.minuteOfDay >= w.startMinute && parts.minuteOfDay < w.endMinute) return at;

  if (parts.minuteOfDay < w.startMinute) {
    return zonedWallTimeToUtc(parts.y, parts.m, parts.d, w.startMinute, timeZone);
  }

  // At/after the window closes: roll to the next local calendar day. Adding
  // 24h in UTC and re-deriving the local date handles month/year rollover
  // and DST without manual calendar arithmetic.
  const nextDayParts = localDateParts(new Date(at.getTime() + 24 * 60 * 60 * 1000), timeZone);
  return zonedWallTimeToUtc(nextDayParts.y, nextDayParts.m, nextDayParts.d, w.startMinute, timeZone);
}

export interface PlannedFollowup {
  step: number;
  kind: 'text' | 'template';
  template: string | null;
  scheduledFor: Date;
}

/**
 * Deterministic, strictly-increasing schedule from `policy.steps`
 * (default: +2h text, +24h template, +72h template — see types.ts). Each
 * offset is anchored at `anchor` and then shifted into the org's send
 * window so nothing goes out at 3am local time.
 */
export function planFollowups(anchor: Date, policy: FollowupPolicy, timeZone: string): PlannedFollowup[] {
  const plan: PlannedFollowup[] = [];
  let previous: Date | null = null;

  policy.steps.forEach((s, i) => {
    const target = new Date(anchor.getTime() + s.afterMinutes * 60 * 1000);
    let scheduledFor = shiftIntoSendWindow(target, policy.sendWindow, timeZone);
    if (previous && scheduledFor.getTime() <= previous.getTime()) {
      scheduledFor = new Date(previous.getTime() + 60 * 1000);
    }
    previous = scheduledFor;
    plan.push({ step: i + 1, kind: s.kind, template: s.kind === 'template' ? s.template ?? null : null, scheduledFor });
  });

  return plan;
}

export type FollowupDecision = { action: 'send' } | { action: 'skip' | 'stop'; reason: FollowupStopReason };

export interface DecideFollowupInput {
  kind: 'text' | 'template';
  anchorAt: Date;
  policyEnabled: boolean;
  lead: { doNotContact: boolean; phone: string | null; stageKind: StageKind };
  session: { mode: 'ai' | 'human' | 'paused'; lastInboundAt: Date | null; windowExpiresAt: Date | null } | null;
  hasActiveVisit: boolean;
  now: Date;
}

/**
 * Runtime source of truth (blueprint §0.10): re-evaluated every time a
 * lead.followup job runs, not just at scheduling time. Order matters —
 * see the table in blueprint §6.
 */
export function decideFollowup(i: DecideFollowupInput): FollowupDecision {
  if (!i.policyEnabled) return { action: 'stop', reason: 'disabled' };
  if (i.lead.doNotContact) return { action: 'stop', reason: 'do_not_contact' };
  if (!i.lead.phone) return { action: 'stop', reason: 'no_phone' };
  if (i.lead.stageKind === 'won' || i.lead.stageKind === 'lost') return { action: 'stop', reason: 'stage_closed' };
  if (i.hasActiveVisit) return { action: 'stop', reason: 'visit_active' };
  if (!i.session) return { action: 'stop', reason: 'no_session' };
  if (i.session.mode !== 'ai') return { action: 'stop', reason: 'human_takeover' };
  if (i.session.lastInboundAt && i.session.lastInboundAt.getTime() > i.anchorAt.getTime()) {
    return { action: 'stop', reason: 'replied' };
  }
  if (i.kind === 'text') {
    const windowOpen = i.session.windowExpiresAt != null && i.session.windowExpiresAt.getTime() > i.now.getTime();
    if (!windowOpen) return { action: 'skip', reason: 'window_closed' };
  }
  return { action: 'send' };
}
