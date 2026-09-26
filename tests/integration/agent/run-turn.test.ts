import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  toolRunnerMock,
  budgetRows,
  appendedMessages,
  sessionRow,
  getSessionHistoryMock,
  getLeadMock,
  setSessionLeadMock,
  setSessionModeMock,
  setSessionLanguageMock,
  recordAgentTurnMock,
  recordAgentEventMock,
} = vi.hoisted(() => ({
  toolRunnerMock: vi.fn(),
  budgetRows: [{ total: '0' }] as { total: string }[],
  appendedMessages: [] as Record<string, unknown>[],
  sessionRow: {
    id: 'session-1',
    orgId: 'org-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    leadId: null as string | null,
    whatsappConversationId: null,
    mode: 'ai' as 'ai' | 'human' | 'paused',
    summary: null,
    agentTurnCount: 0,
    language: null as 'es' | 'en' | 'pt' | null,
    attribution: null,
    handoffReason: null,
    windowExpiresAt: null,
    lastAgentTurnAt: null,
  },
  getSessionHistoryMock: vi.fn(async () => [] as unknown[]),
  getLeadMock: vi.fn(async () => null as unknown),
  setSessionLeadMock: vi.fn(async () => {}),
  setSessionModeMock: vi.fn(async () => {}),
  setSessionLanguageMock: vi.fn(async () => {}),
  recordAgentTurnMock: vi.fn(async () => {}),
  recordAgentEventMock: vi.fn(async () => {}),
}));

const CONFIG_FIXTURE = {
  id: 'config-1',
  orgId: 'org-1',
  persona: 'Asistente inmobiliario',
  tone: 'profesional' as const,
  rules: null,
  prohibited: null,
  faq: [],
  businessHours: { weekly: [], closedNote: null },
  timezone: 'America/Lima',
  qualificationFields: [],
  followupPolicy: {},
  routingMode: 'round_robin' as const,
  dailyTokenBudget: 50_000,
  widgetAllowedOrigins: [],
  channelsEnabled: { whatsapp: true, web: false, voice: false },
  shadowMode: false,
  maxAgentTurns: null as number | null,
  publicPagesEnabled: false,
  voice: {
    voiceProvider: 'azure' as const,
    voiceId: 'es-PE-CamilaNeural',
    language: 'es' as const,
    recordingEnabled: true,
    greetingExtra: null,
    maxCallMinutes: 10,
    monthlyMinuteCap: 300,
    callWindow: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 },
    speedToLead: { enabled: false, delayMinutes: 2, sources: ['manual' as const], staleAfterHours: 12 },
    visitConfirmation: { enabled: false, hoursBefore: 20 },
    reactivation: { enabled: false, coldAfterDays: 14, minDaysBetween: 30, maxPerRun: 20 },
  },
  maxActiveVisitsPerPhone: 2,
  maxListingPhotos: 5,
};

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => budgetRows),
      })),
    })),
  },
}));

vi.mock('@/lib/ai/client', () => ({
  getAnthropicClient: () => ({ beta: { messages: { toolRunner: toolRunnerMock } } }),
  AGENT_MODEL: 'claude-opus-5',
}));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn(async () => CONFIG_FIXTURE),
}));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession: vi.fn(async () => sessionRow),
  getSessionHistory: getSessionHistoryMock,
  appendSessionMessage: vi.fn(async (args: Record<string, unknown>) => {
    appendedMessages.push(args);
    return `msg-${appendedMessages.length}`;
  }),
  setSessionLead: setSessionLeadMock,
  setSessionMode: setSessionModeMock,
  setSessionLanguage: setSessionLanguageMock,
  recordAgentTurn: recordAgentTurnMock,
}));

vi.mock('@/lib/agent/events', () => ({
  recordAgentEvent: recordAgentEventMock,
}));

vi.mock('@/lib/agent/lead', () => ({
  getLead: getLeadMock,
}));

const buildAgentToolsMock = vi.hoisted(() => vi.fn(() => []));
vi.mock('@/lib/agent/tools', () => ({
  buildAgentTools: buildAgentToolsMock,
}));

import { runAgentTurn } from '@/lib/agent/run-turn';

// Phase 8/9 (item A "Override" note): run-turn.ts now iterates the runner
// (`for await`) instead of calling `.done()`, to sum usage across every
// tool-loop iteration — see the cost-fix test below. Defaults to a single
// iteration with the same 120/40 usage the old `.done()`-based tests expected.
function fakeRunner(
  finalContent: Array<{ type: string; [k: string]: unknown }>,
  fullMessages: Array<{ role: string; content: unknown }>,
  iterationUsages: Array<{ input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }> = [
    { input_tokens: 120, output_tokens: 40 },
  ],
) {
  return {
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: async () => {
          if (i >= iterationUsages.length) return { done: true, value: undefined };
          const usage = iterationUsages[i];
          i += 1;
          return { done: false, value: { content: finalContent, usage } };
        },
      };
    },
    params: { messages: fullMessages },
  };
}

describe('runAgentTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetRows.length = 0;
    budgetRows.push({ total: '0' });
    appendedMessages.length = 0;
    sessionRow.leadId = null;
    sessionRow.mode = 'ai';
    sessionRow.agentTurnCount = 0;
    sessionRow.language = null;
    getSessionHistoryMock.mockResolvedValue([]);
    getLeadMock.mockResolvedValue(null);
  });

  it('persists the inbound message and the assistant reply, and returns the reply text', async () => {
    const finalContent = [{ type: 'text', text: 'Hola, ¿en qué te puedo ayudar?' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(result.replyText).toBe('Hola, ¿en qué te puedo ayudar?');
    expect(result.sessionId).toBe('session-1');
    expect(result.handedOffToHuman).toBe(false);
    expect(result.skipped).toBe(false);

    // Both the new inbound user message AND the assistant reply are persisted — not just the reply.
    expect(appendedMessages).toHaveLength(2);
    expect(appendedMessages[0]).toMatchObject({ role: 'user', content: 'hola' });
    expect(appendedMessages[1]).toMatchObject({ role: 'assistant', inputTokens: 120, outputTokens: 40 });
    expect(recordAgentTurnMock).toHaveBeenCalledWith('session-1');
  });

  it('persists tool_use/tool_result turns in between, not just the final reply', async () => {
    const toolUseTurn = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_listings', input: {} }] };
    const toolResultTurn = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] };
    const finalContent = [{ type: 'text', text: 'No encontré nada por ahora.' }];
    const fullMessages = [
      { role: 'user', content: 'busco depa' },
      toolUseTurn,
      toolResultTurn,
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'busco depa' });

    expect(appendedMessages).toHaveLength(4);
    expect(appendedMessages[1].content).toEqual(toolUseTurn.content);
    expect(appendedMessages[2].content).toEqual(toolResultTurn.content);
  });

  it('drops a stray system-role message instead of crashing (never emitted today, defensive)', async () => {
    const finalContent = [{ type: 'text', text: 'ok' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'system', content: 'operator note' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(appendedMessages).toHaveLength(2); // system message filtered out
    expect(appendedMessages.some((m) => m.role === 'system')).toBe(false);
  });

  it('detects a handoff_to_human tool call and reports it on the result', async () => {
    const finalContent = [{ type: 'text', text: 'Te comunico con un asesor.' }];
    const fullMessages = [
      { role: 'user', content: 'quiero hablar con alguien' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'handoff_to_human', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'quiero hablar con alguien' });

    expect(result.handedOffToHuman).toBe(true);
    expect(result.handoffReason).toBe('tool');
  });

  it('short-circuits with a canned reply, hands off to human, and never calls the model when the org is over its daily budget', async () => {
    budgetRows.length = 0;
    budgetRows.push({ total: '999999' });

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(toolRunnerMock).not.toHaveBeenCalled();
    expect(result.replyText).toMatch(/asesor/i);
    expect(result.handedOffToHuman).toBe(true);
    expect(result.handoffReason).toBe('budget');
    expect(appendedMessages).toHaveLength(0);
    expect(setSessionModeMock).toHaveBeenCalledWith('session-1', 'human', expect.any(String), 'budget');
    expect(recordAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', kind: 'handoff', data: expect.objectContaining({ reason: 'budget' }) }),
    );
  });

  it('skips the model entirely when the session is already handed off to a human', async () => {
    sessionRow.mode = 'human';

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(toolRunnerMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.handedOffToHuman).toBe(false);
    expect(appendedMessages).toHaveLength(0);
  });

  it('hands off once the per-session turn cap is reached', async () => {
    sessionRow.agentTurnCount = 30;
    CONFIG_FIXTURE.maxAgentTurns = 30;

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(toolRunnerMock).not.toHaveBeenCalled();
    expect(result.handedOffToHuman).toBe(true);
    expect(result.handoffReason).toBe('turn_cap');
    expect(setSessionModeMock).toHaveBeenCalledWith('session-1', 'human', expect.any(String), 'turn_cap');
    expect(recordAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'handoff', data: expect.objectContaining({ reason: 'turn_cap' }) }),
    );

    CONFIG_FIXTURE.maxAgentTurns = null;
  });

  it('persists a detected language change on the session', async () => {
    const finalContent = [{ type: 'text', text: 'Hi there!' }];
    const fullMessages = [
      { role: 'user', content: 'Hello, I want to know the price of the house' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({
      orgId: 'org-1',
      channel: 'whatsapp',
      externalId: '+51987654321',
      inboundText: 'Hello, I want to know the price of the house',
    });

    expect(setSessionLanguageMock).toHaveBeenCalledWith('session-1', 'en');
    expect(result.language).toBe('en');
  });

  it('dryRun (playground) never checks or spends the org budget', async () => {
    budgetRows.length = 0;
    budgetRows.push({ total: '999999' }); // would short-circuit a real turn

    const finalContent = [{ type: 'text', text: 'Hola desde el playground' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'web', externalId: 'playground:user-1', inboundText: 'hola', dryRun: true });

    expect(toolRunnerMock).toHaveBeenCalled();
    expect(result.replyText).toBe('Hola desde el playground');
    expect(setSessionLanguageMock).not.toHaveBeenCalled();
    expect(recordAgentTurnMock).not.toHaveBeenCalled();
  });

  it('dryRun never trips the turn cap, even when the session is already at/over it', async () => {
    sessionRow.agentTurnCount = 999;
    sessionRow.mode = 'human'; // would also short-circuit a real turn
    CONFIG_FIXTURE.maxAgentTurns = 1;

    const finalContent = [{ type: 'text', text: 'Hola desde el playground' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'web', externalId: 'playground:user-1', inboundText: 'hola', dryRun: true });

    expect(toolRunnerMock).toHaveBeenCalled();
    expect(result.skipped).toBe(false);
    expect(result.handedOffToHuman).toBe(false);
    expect(setSessionModeMock).not.toHaveBeenCalled();

    CONFIG_FIXTURE.maxAgentTurns = null;
  });

  it('Phase 7: threads pageContext/notes/channel into the volatile turn context, never the cached system block', async () => {
    const finalContent = [{ type: 'text', text: 'Hola desde el widget' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    await runAgentTurn({
      orgId: 'org-1',
      channel: 'web',
      externalId: 'web:ws-1',
      inboundText: 'hola',
      pageContext: { listingId: 'listing-1', title: 'Depa Sol', refCode: 'ABC123', publicSlug: 'depa-sol-abcdef' },
      extraContextNotes: ['El usuario viene del chat web; su perfil ya está cargado.'],
    });

    const call = toolRunnerMock.mock.calls[0][0] as { system: Array<{ text: string; cache_control?: unknown }> };
    const [cached, volatile] = call.system;

    expect(cached.cache_control).toEqual({ type: 'ephemeral' });
    expect(cached.text).not.toContain('Depa Sol');
    expect(cached.text).not.toContain('ABC123');
    expect(cached.text).not.toContain('viene del chat web');

    expect(volatile.cache_control).toBeUndefined();
    expect(volatile.text).toContain('Canal: web');
    expect(volatile.text).toContain('Depa Sol');
    expect(volatile.text).toContain('ABC123');
    expect(volatile.text).toContain('viene del chat web');
    expect(volatile.text).toContain('book_visit genera un código');
  });

  it('falls back to a placeholder when the model returns no text blocks', async () => {
    const finalContent = [{ type: 'tool_use', id: 't1', name: 'search_listings', input: {} }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(result.replyText.length).toBeGreaterThan(0);
  });

  it('Phase 8/9 cost fix: sums usage over every tool-loop iteration and persists cost_usd (not just the last API call)', async () => {
    const toolUseTurn = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_listings', input: {} }] };
    const toolResultTurn = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] };
    const finalContent = [{ type: 'text', text: 'Encontré esto para vos.' }];
    const fullMessages = [
      { role: 'user', content: 'busco depa' },
      toolUseTurn,
      toolResultTurn,
      { role: 'assistant', content: finalContent },
    ];
    // Two iterations: the tool_use turn's API call, then the final reply's — both must count.
    toolRunnerMock.mockReturnValue(
      fakeRunner(finalContent, fullMessages, [
        { input_tokens: 500, output_tokens: 50 },
        { input_tokens: 300, output_tokens: 20 },
      ]),
    );

    await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'busco depa' });

    const lastMessage = appendedMessages[appendedMessages.length - 1];
    expect(lastMessage.inputTokens).toBe(800); // 500 + 300, not just the last call's 300
    expect(lastMessage.outputTokens).toBe(70); // 50 + 20
    expect(lastMessage.costUsd).toBeDefined();
    expect(Number(lastMessage.costUsd)).toBeGreaterThan(0);
  });

  it('Phase 8/9: the tool context carries shadowMode from config', async () => {
    CONFIG_FIXTURE.shadowMode = true;
    const finalContent = [{ type: 'text', text: 'Hola' }];
    const fullMessages = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: finalContent },
    ];
    toolRunnerMock.mockReturnValue(fakeRunner(finalContent, fullMessages));

    await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    const lastMessage = appendedMessages[appendedMessages.length - 1];
    expect(lastMessage.sendStatus).toBe('shadow_pending');
    expect(buildAgentToolsMock).toHaveBeenCalledWith(expect.objectContaining({ shadowMode: true, whatsappConversationId: null, voiceCallId: null }));

    CONFIG_FIXTURE.shadowMode = false;
  });
});
