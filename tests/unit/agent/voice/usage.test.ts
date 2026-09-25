import { describe, it, expect } from 'vitest';
import { checkMinuteCap } from '@/lib/agent/voice/usage';

describe('agent/voice/usage — checkMinuteCap', () => {
  it('outbound: allows a call when used + reserved + this call fits under the cap', () => {
    expect(
      checkMinuteCap({ usedMinutes: 100, inFlightCalls: 0, capMinutes: 300, maxCallMinutes: 10, direction: 'outbound' }),
    ).toBe(true);
  });

  it('outbound: reserves maxCallMinutes for every in-flight call, on top of this one', () => {
    // used=280, 1 in-flight (reserves 10), this call reserves 10 more => 300 <= 300 (ok, boundary)
    expect(
      checkMinuteCap({ usedMinutes: 280, inFlightCalls: 1, capMinutes: 300, maxCallMinutes: 10, direction: 'outbound' }),
    ).toBe(true);
    // one more in-flight call pushes it over.
    expect(
      checkMinuteCap({ usedMinutes: 280, inFlightCalls: 2, capMinutes: 300, maxCallMinutes: 10, direction: 'outbound' }),
    ).toBe(false);
  });

  it('outbound: blocks when used alone already meets the cap', () => {
    expect(
      checkMinuteCap({ usedMinutes: 300, inFlightCalls: 0, capMinutes: 300, maxCallMinutes: 10, direction: 'outbound' }),
    ).toBe(false);
  });

  it('inbound: allows while used + reserved is strictly under the cap (no per-call reservation)', () => {
    expect(
      checkMinuteCap({ usedMinutes: 299, inFlightCalls: 0, capMinutes: 300, maxCallMinutes: 10, direction: 'inbound' }),
    ).toBe(true);
    expect(
      checkMinuteCap({ usedMinutes: 300, inFlightCalls: 0, capMinutes: 300, maxCallMinutes: 10, direction: 'inbound' }),
    ).toBe(false);
  });

  it('inbound: in-flight calls still count against the cap', () => {
    expect(
      checkMinuteCap({ usedMinutes: 290, inFlightCalls: 1, capMinutes: 300, maxCallMinutes: 10, direction: 'inbound' }),
    ).toBe(false); // 290 + 10 = 300, not < 300
  });

  it('a zero cap always blocks', () => {
    expect(checkMinuteCap({ usedMinutes: 0, inFlightCalls: 0, capMinutes: 0, maxCallMinutes: 10, direction: 'inbound' })).toBe(false);
    expect(checkMinuteCap({ usedMinutes: 0, inFlightCalls: 0, capMinutes: 0, maxCallMinutes: 10, direction: 'outbound' })).toBe(false);
  });
});
