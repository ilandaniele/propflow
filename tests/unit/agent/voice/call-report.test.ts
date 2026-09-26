import { describe, it, expect, vi, beforeEach } from 'vitest';
import endOfCallFixture from '../../../fixtures/vapi/end-of-call-report.json';
import { mapEndedReason, isHttpsUrl } from '@/lib/agent/voice/call-report';

describe('agent/voice/call-report — isHttpsUrl', () => {
  it('accepts https URLs', () => {
    expect(isHttpsUrl('https://storage.vapi.ai/recordings/x.wav')).toBe(true);
  });

  it('rejects http (non-https) URLs', () => {
    expect(isHttpsUrl('http://storage.vapi.ai/recordings/x.wav')).toBe(false);
  });

  it('rejects garbage that is not a URL at all', () => {
    expect(isHttpsUrl('not-a-url')).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });
});

describe('agent/voice/call-report — mapEndedReason', () => {
  it('customer-busy → busy', () => {
    expect(mapEndedReason('customer-busy', 30)).toBe('busy');
  });

  it('no-answer → no_answer', () => {
    expect(mapEndedReason('no-answer', 30)).toBe('no_answer');
  });

  it('voicemail → voicemail', () => {
    expect(mapEndedReason('voicemail', 30)).toBe('voicemail');
  });

  it('any error* reason → failed', () => {
    expect(mapEndedReason('pipeline-error-openai-llm-failed', 30)).toBe('failed');
  });

  it('under 5s with no matching reason → abandoned', () => {
    expect(mapEndedReason('customer-ended-call', 3)).toBe('abandoned');
  });

  it('everything else → answered', () => {
    expect(mapEndedReason('customer-ended-call', 120)).toBe('answered');
  });

  it('null reason with null duration → answered (never throws)', () => {
    expect(mapEndedReason(null, null)).toBe('answered');
  });

  it('a specific reason wins over the <5s heuristic', () => {
    expect(mapEndedReason('customer-busy', 2)).toBe('busy');
  });
});

const { getCallByVapiId, getCallById, transitionCall, getLead, recordAgentEvent, dbUpdateCalls } = vi.hoisted(() => ({
  getCallByVapiId: vi.fn(),
  getCallById: vi.fn(async () => null),
  transitionCall: vi.fn(),
  getLead: vi.fn(async () => null),
  recordAgentEvent: vi.fn(async () => {}),
  dbUpdateCalls: [] as unknown[],
}));

vi.mock('@/lib/agent/voice/calls', () => ({ getCallByVapiId, getCallById, transitionCall }));
vi.mock('@/lib/agent/lead', () => ({ getLead }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: unknown) => {
        dbUpdateCalls.push({ table, patch });
        return { where: vi.fn(async () => {}) };
      }),
    })),
  },
}));

import { handleEndOfCallReport } from '@/lib/agent/voice/call-report';

const CALL_ROW = {
  id: 'call-row-1',
  orgId: '11111111-2222-3333-4444-555555555555',
  sessionId: 'session-1',
  leadId: 'lead-1',
  visitId: null,
  direction: 'inbound' as const,
  purpose: 'inbound' as const,
  status: 'in_progress' as const,
  vapiCallId: endOfCallFixture.message.call.id,
  customerPhone: '+14155550101',
  startedAt: null,
  endedAt: null,
  durationSeconds: null,
  outcome: null,
  summary: null,
  costUsd: null,
  createdAt: new Date(),
};

describe('agent/voice/call-report — handleEndOfCallReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdateCalls.length = 0;
    getCallByVapiId.mockResolvedValue({ ...CALL_ROW });
    transitionCall.mockImplementation(async (_id: string, from: string[], patch: Record<string, unknown>) => {
      if (!from.includes('in_progress')) return null;
      return { ...CALL_ROW, ...patch };
    });
  });

  it('is a no-op when the call can\'t be resolved to a row', async () => {
    getCallByVapiId.mockResolvedValue(null);
    await handleEndOfCallReport(endOfCallFixture.message as never);
    expect(transitionCall).not.toHaveBeenCalled();
  });

  it('reads recordingUrl/transcript/summary from either the top-level or artifact/analysis field', async () => {
    await handleEndOfCallReport(endOfCallFixture.message as never);
    expect(transitionCall).toHaveBeenCalledWith(
      'call-row-1',
      ['queued', 'dialing', 'in_progress'],
      expect.objectContaining({
        status: 'ended',
        recordingUrl: endOfCallFixture.message.artifact.recordingUrl,
        summary: expect.stringContaining('leaking kitchen faucet'),
        costUsd: '0.4123',
      }),
    );
  });

  it('is idempotent — an already-ended row is a no-op', async () => {
    getCallByVapiId.mockResolvedValue({ ...CALL_ROW, status: 'ended' });
    await handleEndOfCallReport(endOfCallFixture.message as never);
    expect(transitionCall).not.toHaveBeenCalled();
  });

  it('sets the lead to contacted when answered, >=15s and still new', async () => {
    getLead.mockResolvedValue({ id: 'lead-1', stage: 'new', doNotContact: false });
    await handleEndOfCallReport(endOfCallFixture.message as never);
    expect(dbUpdateCalls.length).toBeGreaterThan(0);
    const leadUpdate = dbUpdateCalls.find((c) => (c as { patch: Record<string, unknown> }).patch.stage === 'contacted');
    expect(leadUpdate).toBeDefined();
  });

  it('never touches a lead stage other than new', async () => {
    getLead.mockResolvedValue({ id: 'lead-1', stage: 'qualified', doNotContact: false });
    await handleEndOfCallReport(endOfCallFixture.message as never);
    const leadUpdate = dbUpdateCalls.find((c) => (c as { patch: Record<string, unknown> }).patch.stage === 'contacted');
    expect(leadUpdate).toBeUndefined();
  });

  it('persists recordingUrl as null when it is not https', async () => {
    const httpFixture = {
      ...endOfCallFixture.message,
      recordingUrl: 'http://insecure.example.com/rec.wav',
      artifact: { ...endOfCallFixture.message.artifact, recordingUrl: 'http://insecure.example.com/rec.wav' },
    };
    await handleEndOfCallReport(httpFixture as never);
    expect(transitionCall).toHaveBeenCalledWith(
      'call-row-1',
      ['queued', 'dialing', 'in_progress'],
      expect.objectContaining({ recordingUrl: null }),
    );
  });

  it('records a voice_call event on the session', async () => {
    await handleEndOfCallReport(endOfCallFixture.message as never);
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      kind: 'voice_call',
      data: expect.objectContaining({ callId: 'call-row-1' }),
    }));
  });
});
