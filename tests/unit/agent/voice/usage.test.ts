import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkMinuteCap } from '@/lib/agent/voice/usage';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'set', 'returning', 'selectDistinct']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const gteSpy = vi.fn();
const ltSpy = vi.fn();
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    gte: (...args: Parameters<typeof actual.gte>) => {
      gteSpy(...args);
      return actual.gte(...args);
    },
    lt: (...args: Parameters<typeof actual.lt>) => {
      ltSpy(...args);
      return actual.lt(...args);
    },
  };
});

const { mockSelect, mockSelectDistinct, mockUpdate, getOrCreateAgentConfigMock } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockSelectDistinct: vi.fn(),
  mockUpdate: vi.fn(),
  getOrCreateAgentConfigMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    selectDistinct: (...a: unknown[]) => mockSelectDistinct(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig: getOrCreateAgentConfigMock }));

import { agentCalls } from '@/lib/db/schema';
import { getMonthlyVoiceUsage, failStaleCalls } from '@/lib/agent/voice/usage';

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('agent/voice/usage — getMonthlyVoiceUsage (item 8)', () => {
  it('bounds the in-flight count to rows created within maxCallMinutes + 5min slack', async () => {
    mockSelect
      .mockReturnValueOnce(makeChain([{ value: '42' }])) // used-minutes query
      .mockReturnValueOnce(makeChain([{ value: '2' }])); // in-flight query

    const now = new Date('2026-01-15T12:00:00Z');
    const usage = await getMonthlyVoiceUsage('org-1', 'America/Lima', 10, now);

    expect(usage).toEqual({ usedMinutes: 42, inFlightCalls: 2 });
    // 10 (maxCallMinutes) + 5 (slack) = 15 minutes before `now` — distinct from
    // the used-minutes query's monthStart gte(createdAt, ...) call.
    const expectedCutoffMs = now.getTime() - 15 * 60_000;
    const cutoffCall = gteSpy.mock.calls.find(
      (c) => c[0] === agentCalls.createdAt && (c[1] as Date).getTime() === expectedCutoffMs,
    );
    expect(cutoffCall).toBeDefined();
  });
});

describe('agent/voice/usage — failStaleCalls (item 8)', () => {
  it('is a no-op when nothing is dialing/in_progress', async () => {
    mockSelectDistinct.mockReturnValueOnce(makeChain([]));

    const n = await failStaleCalls();

    expect(n).toBe(0);
    expect(getOrCreateAgentConfigMock).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sweeps stuck calls older than the org's maxCallMinutes + slack as failed/stale", async () => {
    mockSelectDistinct.mockReturnValueOnce(makeChain([{ orgId: 'org-1' }]));
    getOrCreateAgentConfigMock.mockResolvedValueOnce({ voice: { maxCallMinutes: 10 } });
    mockUpdate.mockReturnValueOnce(makeChain([{ id: 'call-1' }, { id: 'call-2' }]));

    const now = new Date('2026-01-15T12:00:00Z');
    const n = await failStaleCalls(now);

    expect(n).toBe(2);
    expect(mockUpdate).toHaveBeenCalledWith(agentCalls);
    const cutoffCall = ltSpy.mock.calls.find((c) => c[0] === agentCalls.createdAt);
    expect(cutoffCall).toBeDefined();
    expect((cutoffCall![1] as Date).getTime()).toBe(now.getTime() - 15 * 60_000);
  });

  it('sums swept counts across multiple orgs', async () => {
    mockSelectDistinct.mockReturnValueOnce(makeChain([{ orgId: 'org-1' }, { orgId: 'org-2' }]));
    getOrCreateAgentConfigMock.mockResolvedValueOnce({ voice: { maxCallMinutes: 10 } }).mockResolvedValueOnce({ voice: { maxCallMinutes: 20 } });
    mockUpdate.mockReturnValueOnce(makeChain([{ id: 'call-1' }])).mockReturnValueOnce(makeChain([{ id: 'call-2' }, { id: 'call-3' }]));

    const n = await failStaleCalls();

    expect(n).toBe(3);
    expect(getOrCreateAgentConfigMock).toHaveBeenCalledTimes(2);
  });
});
