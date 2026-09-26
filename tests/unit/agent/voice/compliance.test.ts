import { describe, it, expect } from 'vitest';
import { decideOutboundCall } from '@/lib/agent/voice/compliance';
import { clampCallWindow } from '@/lib/agent/config-schema';

const BASE = {
  voiceEnabled: true,
  hasNumber: true,
  onDnc: false,
  doNotContact: false,
  phoneVerified: true,
  withinWindow: true,
  capOk: true,
  stale: false,
  visitActive: null as boolean | null,
};

describe('agent/voice/compliance — decideOutboundCall (order)', () => {
  it('dials when every check passes', () => {
    expect(decideOutboundCall(BASE)).toEqual({ action: 'dial' });
  });

  it('voice disabled wins over every other failure', () => {
    expect(decideOutboundCall({ ...BASE, voiceEnabled: false, onDnc: true, doNotContact: true })).toEqual({
      action: 'block',
      reason: 'voice_disabled',
    });
  });

  it('no_number beats dnc/do_not_contact/etc.', () => {
    expect(decideOutboundCall({ ...BASE, hasNumber: false, onDnc: true })).toEqual({ action: 'block', reason: 'no_number' });
  });

  it('dnc beats do_not_contact and later checks', () => {
    expect(decideOutboundCall({ ...BASE, onDnc: true, doNotContact: true, phoneVerified: false })).toEqual({
      action: 'block',
      reason: 'dnc',
    });
  });

  it('do_not_contact beats phoneVerified/window/cap', () => {
    expect(decideOutboundCall({ ...BASE, doNotContact: true, phoneVerified: false, withinWindow: false })).toEqual({
      action: 'block',
      reason: 'do_not_contact',
    });
  });

  it('unverified_phone beats window/cap/stale/visit', () => {
    expect(decideOutboundCall({ ...BASE, phoneVerified: false, withinWindow: false, capOk: false })).toEqual({
      action: 'block',
      reason: 'unverified_phone',
    });
  });

  it('outside hours defers, not blocks — and beats cap/stale/visit', () => {
    expect(decideOutboundCall({ ...BASE, withinWindow: false, capOk: false, stale: true, visitActive: false })).toEqual({
      action: 'defer',
    });
  });

  it('minute_cap beats stale/visit', () => {
    expect(decideOutboundCall({ ...BASE, capOk: false, stale: true, visitActive: false })).toEqual({
      action: 'block',
      reason: 'minute_cap',
    });
  });

  it('stale beats visit_inactive', () => {
    expect(decideOutboundCall({ ...BASE, stale: true, visitActive: false })).toEqual({ action: 'block', reason: 'stale' });
  });

  it('visit_inactive is the last check', () => {
    expect(decideOutboundCall({ ...BASE, visitActive: false })).toEqual({ action: 'block', reason: 'visit_inactive' });
  });

  it('visitActive: null (not applicable, e.g. speed-to-lead) never blocks on it', () => {
    expect(decideOutboundCall({ ...BASE, visitActive: null })).toEqual({ action: 'dial' });
  });

  it('visitActive: true never blocks on it', () => {
    expect(decideOutboundCall({ ...BASE, visitActive: true })).toEqual({ action: 'dial' });
  });
});

describe('agent/voice/compliance — 08:00-21:00 clamp (via config-schema.clampCallWindow)', () => {
  it('clamps a call window configured outside 08:00-21:00 local (480-1260 minutes)', () => {
    const clamped = clampCallWindow({ weekdays: [1, 2, 3], startMinute: 0, endMinute: 1439 });
    expect(clamped.startMinute).toBe(480);
    expect(clamped.endMinute).toBe(1260);
  });

  it('leaves an already-compliant window untouched', () => {
    const clamped = clampCallWindow({ weekdays: [1, 2, 3], startMinute: 540, endMinute: 1200 });
    expect(clamped).toEqual({ weekdays: [1, 2, 3], startMinute: 540, endMinute: 1200 });
  });

  it('drops weekdays outside 1..6 (no Sunday outbound calls, whatever the config says)', () => {
    const clamped = clampCallWindow({ weekdays: [0, 1, 7], startMinute: 540, endMinute: 1200 });
    expect(clamped.weekdays).toEqual([1]);
  });
});
