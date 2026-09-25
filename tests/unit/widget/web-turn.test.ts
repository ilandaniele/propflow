import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  webMessageRateLimit,
  runAgentTurn,
  recordWebMessage,
  setWebSessionContext,
  tryLockWebSession,
  unlockWebSession,
  incrementWebUsage,
  resolveListingRef,
  computeWebCta,
} = vi.hoisted(() => ({
  webMessageRateLimit: vi.fn(),
  runAgentTurn: vi.fn(),
  recordWebMessage: vi.fn(async () => {}),
  setWebSessionContext: vi.fn(async () => {}),
  tryLockWebSession: vi.fn(),
  unlockWebSession: vi.fn(async () => {}),
  incrementWebUsage: vi.fn(),
  resolveListingRef: vi.fn(async () => null),
  computeWebCta: vi.fn(async () => null),
}));

vi.mock('@/lib/ratelimit', () => ({ webMessageRateLimit }));
vi.mock('@/lib/agent/run-turn', () => ({ runAgentTurn }));
vi.mock('@/lib/widget/web-session', () => ({
  recordWebMessage,
  setWebSessionContext,
  tryLockWebSession,
  unlockWebSession,
  webSessionExternalId: (id: string) => `web:${id}`,
}));
vi.mock('@/lib/widget/usage', () => ({ incrementWebUsage }));
vi.mock('@/lib/widget/listing-ref', () => ({ resolveListingRef }));
vi.mock('@/lib/widget/cta', () => ({ computeWebCta }));

import { handleWebMessage } from '@/lib/widget/web-turn';

const CHANNEL = {
  orgId: 'org-1',
  dailyMessageCap: 300,
  whatsappDisplayPhone: '+51999999999',
} as unknown as import('@/lib/widget/channel').WebChannel;

const SESSION = { id: 'ws-1' } as unknown as import('@/lib/widget/web-session').WebSession;

function baseArgs(overrides: Partial<Parameters<typeof handleWebMessage>[0]> = {}) {
  return {
    channel: CHANNEL,
    session: SESSION,
    text: 'hola',
    listingRef: null,
    pageUrl: null,
    ip: '1.2.3.4',
    ...overrides,
  };
}

describe('handleWebMessage — message usage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webMessageRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
    tryLockWebSession.mockResolvedValue(true);
    incrementWebUsage.mockResolvedValue({ allowed: true, count: 1 });
    runAgentTurn.mockResolvedValue({
      sessionId: 'as-1', leadId: null, replyText: 'hola!', skipped: false, handedOffToHuman: false,
    });
  });

  it('does not increment usage when rate-limited (429, before locking)', async () => {
    webMessageRateLimit.mockReturnValue({ success: false, retryAfterMs: 5000 });
    const result = await handleWebMessage(baseArgs());
    expect(result.status).toBe(429);
    expect(tryLockWebSession).not.toHaveBeenCalled();
    expect(incrementWebUsage).not.toHaveBeenCalled();
  });

  it('does not increment usage when the session lock is already held (409)', async () => {
    tryLockWebSession.mockResolvedValue(false);
    const result = await handleWebMessage(baseArgs());
    expect(result.status).toBe(409);
    expect(incrementWebUsage).not.toHaveBeenCalled();
  });

  it('increments usage only after the lock is acquired, right before runAgentTurn', async () => {
    const callOrder: string[] = [];
    tryLockWebSession.mockImplementation(async () => { callOrder.push('lock'); return true; });
    incrementWebUsage.mockImplementation(async () => { callOrder.push('increment'); return { allowed: true, count: 1 }; });
    runAgentTurn.mockImplementation(async () => {
      callOrder.push('runAgentTurn');
      return { sessionId: 'as-1', leadId: null, replyText: 'hola!', skipped: false, handedOffToHuman: false };
    });

    const result = await handleWebMessage(baseArgs());

    expect(result.status).toBe(200);
    expect(callOrder).toEqual(['lock', 'increment', 'runAgentTurn']);
  });

  it('still increments (spends a credit) and returns 503 with a CTA when the daily cap is hit, then unlocks', async () => {
    incrementWebUsage.mockResolvedValue({ allowed: false, count: 301 });
    const result = await handleWebMessage(baseArgs());
    expect(result.status).toBe(503);
    expect(incrementWebUsage).toHaveBeenCalledTimes(1);
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(unlockWebSession).toHaveBeenCalledWith('ws-1');
  });

  it('unlocks the session even when runAgentTurn throws, without skipping the usage increment that already happened', async () => {
    runAgentTurn.mockRejectedValue(new Error('boom'));
    await expect(handleWebMessage(baseArgs())).rejects.toThrow('boom');
    expect(incrementWebUsage).toHaveBeenCalledTimes(1);
    expect(unlockWebSession).toHaveBeenCalledWith('ws-1');
  });
});
