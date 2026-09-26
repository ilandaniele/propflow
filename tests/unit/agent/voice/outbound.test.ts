import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getLeadMock,
  createCallRowMock,
  getCallByIdMock,
  getOrgVoiceChannelMock,
  transitionCallMock,
  evaluateOutboundCallMock,
  enqueueJobMock,
  getOrCreateSessionMock,
  buildVapiAssistantMock,
  createVapiCallMock,
  getOrCreateAgentConfigMock,
  nextWindowStartMock,
  getVisitMock,
} = vi.hoisted(() => ({
  getLeadMock: vi.fn(),
  createCallRowMock: vi.fn(),
  getCallByIdMock: vi.fn(),
  getOrgVoiceChannelMock: vi.fn(),
  transitionCallMock: vi.fn(),
  evaluateOutboundCallMock: vi.fn(),
  enqueueJobMock: vi.fn(),
  getOrCreateSessionMock: vi.fn(),
  buildVapiAssistantMock: vi.fn(),
  createVapiCallMock: vi.fn(),
  getOrCreateAgentConfigMock: vi.fn(),
  nextWindowStartMock: vi.fn(),
  getVisitMock: vi.fn(),
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/agent/lead', () => ({ getLead: getLeadMock }));
vi.mock('@/lib/agent/visits/service', () => ({ getVisit: getVisitMock }));
vi.mock('@/lib/agent/visits/slots', () => ({ formatSlotLabel: () => 'mié 1 oct, 10:30' }));
vi.mock('@/lib/agent/config-schema', () => ({ nextWindowStart: nextWindowStartMock }));
vi.mock('@/lib/agent/jobs', () => ({ enqueueJob: enqueueJobMock }));
vi.mock('@/lib/agent/session', () => ({ getOrCreateSession: getOrCreateSessionMock }));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig: getOrCreateAgentConfigMock }));
vi.mock('@/lib/agent/voice/calls', () => ({
  createCallRow: createCallRowMock,
  getCallById: getCallByIdMock,
  getOrgVoiceChannel: getOrgVoiceChannelMock,
  transitionCall: transitionCallMock,
}));
vi.mock('@/lib/agent/voice/compliance', () => ({ evaluateOutboundCall: evaluateOutboundCallMock }));
vi.mock('@/lib/agent/voice/assistant', () => ({
  buildVapiAssistant: buildVapiAssistantMock,
  vapiServerUrl: () => 'https://app.test/api/agent/voice/vapi',
}));

import { VapiApiError } from '@/lib/agent/voice/vapi-client';
vi.mock('@/lib/agent/voice/vapi-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/voice/vapi-client')>('@/lib/agent/voice/vapi-client');
  return { ...actual, createVapiCall: createVapiCallMock };
});

import { queueOutboundCall, runOutboundCallJob } from '@/lib/agent/voice/outbound';

const CONFIG = {
  timezone: 'America/Lima',
  voice: { callWindow: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 } },
};

function fakeCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    orgId: 'org-1',
    sessionId: null,
    leadId: 'lead-1',
    visitId: null,
    direction: 'outbound',
    purpose: 'speed_to_lead',
    status: 'queued',
    vapiCallId: null,
    customerPhone: '+51999888777',
    startedAt: null,
    endedAt: null,
    durationSeconds: null,
    outcome: null,
    summary: null,
    costUsd: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('agent/voice/outbound — queueOutboundCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks up the lead phone and inserts the row + enqueues the dialer job', async () => {
    getLeadMock.mockResolvedValue({ phone: '+51999888777' });
    createCallRowMock.mockResolvedValue({ id: 'call-1' });

    const id = await queueOutboundCall({ orgId: 'org-1', leadId: 'lead-1', purpose: 'speed_to_lead', dedupeKey: 'stl:lead-1' });

    expect(id).toBe('call-1');
    expect(createCallRowMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', leadId: 'lead-1', customerPhone: '+51999888777', dedupeKey: 'stl:lead-1', status: 'queued' }),
    );
    expect(enqueueJobMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', payload: { callId: 'call-1' } }));
  });

  it('returns null on a dedupe-key conflict, without enqueueing a job', async () => {
    getLeadMock.mockResolvedValue({ phone: '+51999888777' });
    createCallRowMock.mockResolvedValue(null);

    const id = await queueOutboundCall({ orgId: 'org-1', leadId: 'lead-1', purpose: 'speed_to_lead', dedupeKey: 'stl:lead-1' });

    expect(id).toBeNull();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('normalizes a phone missing the leading + before storing it', async () => {
    getLeadMock.mockResolvedValue({ phone: '51999888777' });
    createCallRowMock.mockResolvedValue({ id: 'call-1' });

    await queueOutboundCall({ orgId: 'org-1', leadId: 'lead-1', purpose: 'speed_to_lead', dedupeKey: 'stl:lead-1' });

    expect(createCallRowMock).toHaveBeenCalledWith(expect.objectContaining({ customerPhone: '+51999888777' }));
  });

  it('stores a null customerPhone for an unshapeable phone (too short/garbage)', async () => {
    getLeadMock.mockResolvedValue({ phone: 'abc' });
    createCallRowMock.mockResolvedValue({ id: 'call-1' });

    await queueOutboundCall({ orgId: 'org-1', leadId: 'lead-1', purpose: 'speed_to_lead', dedupeKey: 'stl:lead-1' });

    expect(createCallRowMock).toHaveBeenCalledWith(expect.objectContaining({ customerPhone: null }));
  });
});

describe('agent/voice/outbound — runOutboundCallJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateAgentConfigMock.mockResolvedValue(CONFIG);
  });

  it('a non-queued row is a no-op', async () => {
    getCallByIdMock.mockResolvedValue(fakeCall({ status: 'in_progress' }));

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(evaluateOutboundCallMock).not.toHaveBeenCalled();
    expect(transitionCallMock).not.toHaveBeenCalled();
  });

  it('defer: re-enqueues the job at the next window start, without dialing', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'defer' });
    const nextStart = new Date('2026-01-05T13:00:00Z');
    nextWindowStartMock.mockReturnValue(nextStart);

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(enqueueJobMock).toHaveBeenCalledWith({ orgId: 'org-1', kind: 'voice.outbound_call', payload: { callId: 'call-1' }, runAt: nextStart });
    expect(transitionCallMock).not.toHaveBeenCalled();
    expect(createVapiCallMock).not.toHaveBeenCalled();
  });

  it('block: transitions to blocked with the reason, no fetch', async () => {
    getCallByIdMock.mockResolvedValue(fakeCall());
    evaluateOutboundCallMock.mockResolvedValue({ action: 'block', reason: 'dnc' });

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['queued'], { status: 'blocked', blockReason: 'dnc' });
    expect(createVapiCallMock).not.toHaveBeenCalled();
  });

  it('block with reason "stale" transitions to skipped, not blocked', async () => {
    getCallByIdMock.mockResolvedValue(fakeCall());
    evaluateOutboundCallMock.mockResolvedValue({ action: 'block', reason: 'stale' });

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['queued'], { status: 'skipped', blockReason: 'stale' });
  });

  it('dial: 2xx sets vapiCallId and in_progress', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'dial' });
    transitionCallMock.mockResolvedValue(call);
    getOrgVoiceChannelMock.mockResolvedValue({ phoneNumberId: 'pn-1' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    buildVapiAssistantMock.mockResolvedValue({ firstMessage: 'hola' });
    createVapiCallMock.mockResolvedValue({ id: 'vapi-call-1', status: 'queued' });

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['dialing'], { status: 'in_progress', vapiCallId: 'vapi-call-1' });
  });

  it('dial: a 500 from Vapi puts the call back to queued and re-throws (job retry)', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'dial' });
    transitionCallMock.mockResolvedValue(call);
    getOrgVoiceChannelMock.mockResolvedValue({ phoneNumberId: 'pn-1' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    buildVapiAssistantMock.mockResolvedValue({ firstMessage: 'hola' });
    createVapiCallMock.mockRejectedValue(new VapiApiError(500, 'boom'));

    await expect(runOutboundCallJob({ callId: 'call-1' }, 'org-1')).rejects.toThrow();

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['dialing'], { status: 'queued' });
  });

  it('dial: a 400 from Vapi marks the call failed (no retry, no throw)', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'dial' });
    transitionCallMock.mockResolvedValue(call);
    getOrgVoiceChannelMock.mockResolvedValue({ phoneNumberId: 'pn-1' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    buildVapiAssistantMock.mockResolvedValue({ firstMessage: 'hola' });
    createVapiCallMock.mockRejectedValue(new VapiApiError(400, 'bad request'));

    await expect(runOutboundCallJob({ callId: 'call-1' }, 'org-1')).resolves.toBeUndefined();

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['dialing'], { status: 'failed', blockReason: 'vapi_error_400' });
  });

  it('dial: a network/timeout error (status 0) marks the call failed as dial_uncertain and never retries', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'dial' });
    transitionCallMock.mockResolvedValue(call);
    getOrgVoiceChannelMock.mockResolvedValue({ phoneNumberId: 'pn-1' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    buildVapiAssistantMock.mockResolvedValue({ firstMessage: 'hola' });
    createVapiCallMock.mockRejectedValue(new VapiApiError(0, 'network_or_timeout'));

    await expect(runOutboundCallJob({ callId: 'call-1' }, 'org-1')).resolves.toBeUndefined();

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['dialing'], { status: 'failed', blockReason: 'dial_uncertain' });
  });

  it('an invalid/unshapeable customerPhone is blocked as no_number before compliance ever runs', async () => {
    getCallByIdMock.mockResolvedValue(fakeCall({ customerPhone: 'not-a-phone' }));

    await runOutboundCallJob({ callId: 'call-1' }, 'org-1');

    expect(evaluateOutboundCallMock).not.toHaveBeenCalled();
    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['queued'], { status: 'blocked', blockReason: 'no_number' });
  });

  it('a setup failure before dialing (e.g. session lookup throws) reverts to queued and rethrows', async () => {
    const call = fakeCall();
    getCallByIdMock.mockResolvedValue(call);
    evaluateOutboundCallMock.mockResolvedValue({ action: 'dial' });
    transitionCallMock.mockResolvedValue(call);
    getOrgVoiceChannelMock.mockResolvedValue({ phoneNumberId: 'pn-1' });
    getOrCreateSessionMock.mockRejectedValue(new Error('db hiccup'));

    await expect(runOutboundCallJob({ callId: 'call-1' }, 'org-1')).rejects.toThrow('db hiccup');

    expect(transitionCallMock).toHaveBeenCalledWith('call-1', ['dialing'], { status: 'queued' });
    expect(createVapiCallMock).not.toHaveBeenCalled();
  });
});
