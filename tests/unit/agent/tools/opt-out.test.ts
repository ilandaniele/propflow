import { describe, it, expect, vi, beforeEach } from 'vitest';

const { addDoNotCall } = vi.hoisted(() => ({
  addDoNotCall: vi.fn(async () => {}),
}));

vi.mock('@/lib/agent/voice/dnc', () => ({ addDoNotCall }));

import { makeOptOutOfCallsTool } from '@/lib/agent/tools/opt-out-of-calls';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'voice',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: 'lead-1' },
    attribution: null,
    webSessionId: null,
    shadowMode: false,
    whatsappConversationId: null,
    voiceCallId: 'call-1',
    ...overrides,
  };
}

describe('opt_out_of_calls tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a caller_request DNC entry for a genuine E.164 externalId', async () => {
    const tool = makeOptOutOfCallsTool(makeCtx());
    const result = await tool.run({ reason: 'no molestar' });
    expect(addDoNotCall).toHaveBeenCalledWith({ orgId: 'org-1', phoneE164: '+51987654321', source: 'caller_request', reason: 'no molestar' });
    expect(String(result)).toMatch(/no te vamos a volver a llamar/i);
  });

  it('never writes do_not_contact — only voice_do_not_call, via addDoNotCall', async () => {
    const tool = makeOptOutOfCallsTool(makeCtx());
    await tool.run({});
    expect(addDoNotCall).toHaveBeenCalledTimes(1);
    expect(addDoNotCall.mock.calls[0][0]).not.toHaveProperty('doNotContact');
  });

  it('a non-E.164 externalId (a web session, or a callerless voice call) is never persisted', async () => {
    const tool = makeOptOutOfCallsTool(makeCtx({ externalId: 'call:vapi-abc123' }));
    const result = await tool.run({});
    expect(addDoNotCall).not.toHaveBeenCalled();
    expect(String(result)).toBeTruthy();
  });

  it('dryRun never persists', async () => {
    const tool = makeOptOutOfCallsTool(makeCtx({ dryRun: true }));
    const result = await tool.run({});
    expect(addDoNotCall).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/SIMULACIÓN/);
  });
});
