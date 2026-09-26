import { describe, it, expect } from 'vitest';
import { decideFollowup, planFollowups, shiftIntoSendWindow } from '@/lib/leads/followup-plan';
import { parseFollowupPolicy } from '@/lib/leads/types';

const LIMA = 'America/Lima'; // UTC-5, no DST
const WINDOW = { startMinute: 540, endMinute: 1200 }; // 09:00-20:00

describe('leads/followup-plan — shiftIntoSendWindow', () => {
  it('leaves a time already inside the window unchanged', () => {
    const at = new Date('2026-03-10T15:00:00-05:00'); // 10:00 Lima
    expect(shiftIntoSendWindow(at, WINDOW, LIMA)).toEqual(at);
  });

  it('shifts a too-early time to the same local day at the window start', () => {
    const at = new Date('2026-03-10T05:00:00-05:00'); // 05:00 Lima
    const shifted = shiftIntoSendWindow(at, WINDOW, LIMA);
    expect(shifted.toISOString()).toBe(new Date('2026-03-10T09:00:00-05:00').toISOString()); // 09:00 Lima same day
  });

  it('shifts a 21:30 Lima anchor to 09:00 the next day', () => {
    const anchor = new Date('2026-03-09T21:30:00-05:00');
    const shifted = shiftIntoSendWindow(anchor, WINDOW, LIMA);
    expect(shifted.toISOString()).toBe(new Date('2026-03-10T09:00:00-05:00').toISOString());
  });
});

describe('leads/followup-plan — planFollowups', () => {
  const policy = parseFollowupPolicy({});

  it('applies the default +2h/+24h/+72h offsets, strictly increasing', () => {
    const anchor = new Date('2026-03-10T10:00:00-05:00'); // 10:00 Lima — inside window
    const plan = planFollowups(anchor, policy, LIMA);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ step: 1, kind: 'text', template: null });
    expect(plan[1]).toMatchObject({ step: 2, kind: 'template', template: 'seguimiento_lead' });
    expect(plan[2]).toMatchObject({ step: 3, kind: 'template', template: 'reactivacion_lead' });
    expect(plan[0].scheduledFor.getTime()).toBeLessThan(plan[1].scheduledFor.getTime());
    expect(plan[1].scheduledFor.getTime()).toBeLessThan(plan[2].scheduledFor.getTime());
    // +2h from 10:00 Lima = 12:00 Lima, inside the window.
    expect(plan[0].scheduledFor.toISOString()).toBe(new Date('2026-03-10T12:00:00-05:00').toISOString());
  });

  it('a 21:30 Lima anchor shifts the +2h step to 09:00 the next day', () => {
    const anchor = new Date('2026-03-09T21:30:00-05:00');
    const plan = planFollowups(anchor, policy, LIMA);
    // +2h raw = 23:30 Lima, after the window closes -> next day 09:00.
    expect(plan[0].scheduledFor.toISOString()).toBe(new Date('2026-03-10T09:00:00-05:00').toISOString());
  });
});

describe('leads/followup-plan — decideFollowup', () => {
  const base = {
    kind: 'text' as const,
    anchorAt: new Date('2026-03-10T15:00:00Z'),
    policyEnabled: true,
    lead: { doNotContact: false, phone: '+51999999999', stageKind: 'open' as const },
    session: { mode: 'ai' as const, lastInboundAt: null, windowExpiresAt: new Date('2026-03-10T20:00:00Z') },
    hasActiveVisit: false,
    now: new Date('2026-03-10T16:00:00Z'),
  };

  it('stops when the policy is disabled', () => {
    expect(decideFollowup({ ...base, policyEnabled: false })).toEqual({ action: 'stop', reason: 'disabled' });
  });

  it('stops on do_not_contact', () => {
    expect(decideFollowup({ ...base, lead: { ...base.lead, doNotContact: true } })).toEqual({ action: 'stop', reason: 'do_not_contact' });
  });

  it('stops when there is no phone', () => {
    expect(decideFollowup({ ...base, lead: { ...base.lead, phone: null } })).toEqual({ action: 'stop', reason: 'no_phone' });
  });

  it('stops when the stage is won or lost', () => {
    expect(decideFollowup({ ...base, lead: { ...base.lead, stageKind: 'won' } })).toEqual({ action: 'stop', reason: 'stage_closed' });
    expect(decideFollowup({ ...base, lead: { ...base.lead, stageKind: 'lost' } })).toEqual({ action: 'stop', reason: 'stage_closed' });
  });

  it('stops when the lead has an active visit', () => {
    expect(decideFollowup({ ...base, hasActiveVisit: true })).toEqual({ action: 'stop', reason: 'visit_active' });
  });

  it('stops when there is no session', () => {
    expect(decideFollowup({ ...base, session: null })).toEqual({ action: 'stop', reason: 'no_session' });
  });

  it('stops when the session is not in ai mode', () => {
    expect(decideFollowup({ ...base, session: { ...base.session, mode: 'human' } })).toEqual({ action: 'stop', reason: 'human_takeover' });
  });

  it('stops when the lead replied after the anchor', () => {
    expect(decideFollowup({ ...base, session: { ...base.session, lastInboundAt: new Date('2026-03-10T15:30:00Z') } }))
      .toEqual({ action: 'stop', reason: 'replied' });
  });

  it('skips a text step when the 24h window is closed, without stopping the sequence', () => {
    expect(decideFollowup({ ...base, session: { ...base.session, windowExpiresAt: new Date('2026-03-10T15:30:00Z') } }))
      .toEqual({ action: 'skip', reason: 'window_closed' });
  });

  it('sends a template step even when the 24h window is closed', () => {
    expect(decideFollowup({ ...base, kind: 'template', session: { ...base.session, windowExpiresAt: null } }))
      .toEqual({ action: 'send' });
  });

  it('sends when every condition passes', () => {
    expect(decideFollowup(base)).toEqual({ action: 'send' });
  });
});
