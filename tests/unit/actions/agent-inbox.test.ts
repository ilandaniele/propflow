/**
 * Unit tests for the agent inbox Server Actions.
 *
 * Covers:
 * 1. Unauthorized calls
 * 2. IDOR: a session from another org resolves as NOT_FOUND (getSessionById is org-scoped)
 * 3. takeOverSession / returnSessionToAi — mode flip + event; return re-enqueues a turn when messages are pending
 * 4. sendAgentInboxReply — implicit take-over from 'ai' mode, and WINDOW_CLOSED mapping
 * 5. approveAgentSuggestion / discardAgentSuggestion
 * 6. updateAgentLiveSettingsAction validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440003';
const SESSION_UUID = '550e8400-e29b-41d4-a716-446655440004';
const CONVERSATION_UUID = '550e8400-e29b-41d4-a716-446655440005';
const SUGGESTION_UUID = '550e8400-e29b-41d4-a716-446655440006';

interface MockSession {
  id: string;
  orgId: string;
  channel: 'whatsapp';
  externalId: string;
  leadId: string | null;
  whatsappConversationId: string | null;
  mode: 'ai' | 'human' | 'paused';
  summary: string | null;
  agentTurnCount: number;
  language: null;
  attribution: null;
  handoffReason: null;
  windowExpiresAt: null;
  lastAgentTurnAt: null;
}

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    id: SESSION_UUID,
    orgId: ORG_UUID,
    channel: 'whatsapp',
    externalId: '+51999999999',
    leadId: null,
    whatsappConversationId: CONVERSATION_UUID,
    mode: 'ai',
    summary: null,
    agentTurnCount: 0,
    language: null,
    attribution: null,
    handoffReason: null,
    windowExpiresAt: null,
    lastAgentTurnAt: null,
    ...overrides,
  };
}

// ─── Shared mock state ────────────────────────────────────────────────────────

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
  session: makeSession() as MockSession | null,
  sendOutcome: { ok: true, messageId: 'msg-1' } as { ok: true; messageId: string } | { ok: false; code: string },
  approveOutcome: { ok: true, messageId: 'msg-2' } as { ok: true; messageId: string } | { ok: false; code: string },
  hasPending: false,
};

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockGetSessionById = vi.fn();
const mockSetSessionMode = vi.fn();
const mockResetTurnCount = vi.fn();
vi.mock('@/lib/agent/session', () => ({
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  setSessionMode: (...args: unknown[]) => mockSetSessionMode(...args),
  resetTurnCount: (...args: unknown[]) => mockResetTurnCount(...args),
}));

const mockRecordAgentEvent = vi.fn();
vi.mock('@/lib/agent/events', () => ({
  recordAgentEvent: (...args: unknown[]) => mockRecordAgentEvent(...args),
}));

const mockSendWhatsAppText = vi.fn();
vi.mock('@/lib/agent/outbound', () => ({
  sendWhatsAppText: (...args: unknown[]) => mockSendWhatsAppText(...args),
}));

const mockApproveSuggestion = vi.fn();
const mockDiscardSuggestion = vi.fn();
vi.mock('@/lib/agent/suggestions', () => ({
  approveSuggestion: (...args: unknown[]) => mockApproveSuggestion(...args),
  discardSuggestion: (...args: unknown[]) => mockDiscardSuggestion(...args),
}));

const mockUpdateAgentLiveSettings = vi.fn();
vi.mock('@/lib/agent/config', () => ({
  updateAgentLiveSettings: (...args: unknown[]) => mockUpdateAgentLiveSettings(...args),
}));

const mockEnqueueJob = vi.fn();
vi.mock('@/lib/agent/jobs', () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

const mockHasPendingInbound = vi.fn();
vi.mock('@/lib/whatsapp/db', () => ({
  hasPendingInbound: (...args: unknown[]) => mockHasPendingInbound(...args),
}));

import {
  takeOverSession,
  returnSessionToAi,
  sendAgentInboxReply,
  approveAgentSuggestion,
  discardAgentSuggestion,
  updateAgentLiveSettingsAction,
} from '@/app/actions/agent-inbox';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.set(k, v));
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockState.session = makeSession();
  mockState.sendOutcome = { ok: true, messageId: 'msg-1' };
  mockState.approveOutcome = { ok: true, messageId: 'msg-2' };
  mockState.hasPending = false;

  mockGetSessionById.mockImplementation(async () => mockState.session);
  mockSetSessionMode.mockResolvedValue(undefined);
  mockResetTurnCount.mockResolvedValue(undefined);
  mockRecordAgentEvent.mockResolvedValue(undefined);
  mockSendWhatsAppText.mockImplementation(async () => mockState.sendOutcome);
  mockApproveSuggestion.mockImplementation(async () => mockState.approveOutcome);
  mockDiscardSuggestion.mockResolvedValue(undefined);
  mockUpdateAgentLiveSettings.mockResolvedValue({});
  mockEnqueueJob.mockResolvedValue('job-1');
  mockHasPendingInbound.mockImplementation(async () => mockState.hasPending);
});

// ─── takeOverSession ────────────────────────────────────────────────────────────

describe('takeOverSession', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await takeOverSession({}, fd({ session_id: SESSION_UUID }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND for a session from another org (IDOR)', async () => {
    mockState.session = null; // getSessionById is org-scoped — a cross-org id resolves to null
    const result = await takeOverSession({}, fd({ session_id: SESSION_UUID }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('sets mode to human with reason manual and records an event', async () => {
    const result = await takeOverSession({}, fd({ session_id: SESSION_UUID }));
    expect(result.error).toBeUndefined();
    expect(mockSetSessionMode).toHaveBeenCalledWith(SESSION_UUID, 'human', undefined, 'manual');
    expect(mockRecordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_UUID,
      sessionId: SESSION_UUID,
      kind: 'mode_change',
      data: { to: 'human' },
    }));
  });
});

// ─── returnSessionToAi ──────────────────────────────────────────────────────────

describe('returnSessionToAi', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await returnSessionToAi({}, fd({ session_id: SESSION_UUID }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('resets mode to ai and the turn count, without re-enqueuing when nothing is pending', async () => {
    mockState.hasPending = false;
    const result = await returnSessionToAi({}, fd({ session_id: SESSION_UUID }));
    expect(result.error).toBeUndefined();
    expect(mockSetSessionMode).toHaveBeenCalledWith(SESSION_UUID, 'ai');
    expect(mockResetTurnCount).toHaveBeenCalledWith(SESSION_UUID);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('re-enqueues an agent turn when inbound messages are still pending', async () => {
    mockState.hasPending = true;
    const result = await returnSessionToAi({}, fd({ session_id: SESSION_UUID }));
    expect(result.error).toBeUndefined();
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_UUID,
      kind: 'agent.whatsapp_turn',
      payload: { conversationId: CONVERSATION_UUID, externalPhone: mockState.session!.externalId },
    }));
  });
});

// ─── sendAgentInboxReply ────────────────────────────────────────────────────────

describe('sendAgentInboxReply', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR when body is empty', async () => {
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: '' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for a session from another org (IDOR)', async () => {
    mockState.session = null;
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('implicitly takes over when the session is still in ai mode', async () => {
    mockState.session = makeSession({ mode: 'ai' });
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(result.error).toBeUndefined();
    expect(mockSetSessionMode).toHaveBeenCalledWith(SESSION_UUID, 'human', undefined, 'manual');
    // The take-over happens before the send.
    const setModeOrder = mockSetSessionMode.mock.invocationCallOrder[0];
    const sendOrder = mockSendWhatsAppText.mock.invocationCallOrder[0];
    expect(setModeOrder).toBeLessThan(sendOrder);
  });

  it('does not re-take-over when the session is already human', async () => {
    mockState.session = makeSession({ mode: 'human' });
    await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(mockSetSessionMode).not.toHaveBeenCalled();
  });

  it('maps WINDOW_CLOSED to a validation-style error', async () => {
    mockState.sendOutcome = { ok: false, code: 'WINDOW_CLOSED' };
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(result.error?.code).toBe('WINDOW_CLOSED');
  });

  it('happy path sends the reply as a human', async () => {
    const result = await sendAgentInboxReply({}, fd({ session_id: SESSION_UUID, body: 'hola' }));
    expect(result.error).toBeUndefined();
    expect(mockSendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_UUID,
      conversationId: CONVERSATION_UUID,
      body: 'hola',
      senderKind: 'human',
      sentByProfileId: 'admin-uuid',
    }));
  });
});

// ─── approveAgentSuggestion / discardAgentSuggestion ───────────────────────────

describe('approveAgentSuggestion', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await approveAgentSuggestion({}, fd({ suggestion_id: SUGGESTION_UUID }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('maps WINDOW_CLOSED to a validation-style error', async () => {
    mockState.approveOutcome = { ok: false, code: 'WINDOW_CLOSED' };
    const result = await approveAgentSuggestion({}, fd({ suggestion_id: SUGGESTION_UUID }));
    expect(result.error?.code).toBe('WINDOW_CLOSED');
  });

  it('happy path approves and sends', async () => {
    const result = await approveAgentSuggestion({}, fd({ suggestion_id: SUGGESTION_UUID, body: 'edited text' }));
    expect(result.error).toBeUndefined();
    expect(mockApproveSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_UUID,
      suggestionId: SUGGESTION_UUID,
      profileId: 'admin-uuid',
      editedBody: 'edited text',
    }));
  });
});

describe('discardAgentSuggestion', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await discardAgentSuggestion({}, fd({ suggestion_id: SUGGESTION_UUID }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('happy path discards the suggestion', async () => {
    const result = await discardAgentSuggestion({}, fd({ suggestion_id: SUGGESTION_UUID }));
    expect(result.error).toBeUndefined();
    expect(mockDiscardSuggestion).toHaveBeenCalledWith({
      orgId: ORG_UUID,
      suggestionId: SUGGESTION_UUID,
      profileId: 'admin-uuid',
    });
  });
});

// ─── updateAgentLiveSettingsAction ──────────────────────────────────────────────

describe('updateAgentLiveSettingsAction', () => {
  it('returns UNAUTHORIZED when caller is not admin', async () => {
    mockState.adminRole = 'tenant';
    const result = await updateAgentLiveSettingsAction({}, fd({ whatsapp_enabled: 'true', shadow_mode: 'false' }));
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('maps empty max_agent_turns to null', async () => {
    const result = await updateAgentLiveSettingsAction({}, fd({ whatsapp_enabled: 'true', shadow_mode: 'false', max_agent_turns: '' }));
    expect(result.error).toBeUndefined();
    expect(mockUpdateAgentLiveSettings).toHaveBeenCalledWith(ORG_UUID, {
      whatsappEnabled: true,
      shadowMode: false,
      maxAgentTurns: null,
    });
  });

  it('returns VALIDATION_ERROR when max_agent_turns is out of range', async () => {
    const result = await updateAgentLiveSettingsAction({}, fd({ whatsapp_enabled: 'true', shadow_mode: 'false', max_agent_turns: '500' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateAgentLiveSettings).not.toHaveBeenCalled();
  });

  it('happy path forwards parsed settings', async () => {
    const result = await updateAgentLiveSettingsAction({}, fd({ whatsapp_enabled: 'true', shadow_mode: 'true', max_agent_turns: '10' }));
    expect(result.error).toBeUndefined();
    expect(mockUpdateAgentLiveSettings).toHaveBeenCalledWith(ORG_UUID, {
      whatsappEnabled: true,
      shadowMode: true,
      maxAgentTurns: 10,
    });
  });
});
