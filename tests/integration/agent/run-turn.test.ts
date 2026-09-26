import { describe, it, expect, vi, beforeEach } from 'vitest';

const { toolRunnerMock, budgetRows, appendedMessages, sessionRow, getSessionHistoryMock, getLeadMock, setSessionLeadMock } = vi.hoisted(() => ({
  toolRunnerMock: vi.fn(),
  budgetRows: [{ total: '0' }] as { total: string }[],
  appendedMessages: [] as Record<string, unknown>[],
  sessionRow: { id: 'session-1', orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', leadId: null as string | null, whatsappConversationId: null, mode: 'ai', summary: null },
  getSessionHistoryMock: vi.fn(async () => [] as unknown[]),
  getLeadMock: vi.fn(async () => null as unknown),
  setSessionLeadMock: vi.fn(async () => {}),
}));

const CONFIG_FIXTURE = {
  id: 'config-1',
  orgId: 'org-1',
  persona: 'Asistente inmobiliario',
  tone: 'profesional' as const,
  rules: null,
  prohibited: null,
  faq: [],
  businessHours: {},
  timezone: 'America/Lima',
  qualificationFields: [],
  followupPolicy: {},
  routingMode: 'round_robin' as const,
  dailyTokenBudget: 50_000,
  widgetAllowedOrigins: [],
  channelsEnabled: { whatsapp: true, web: false, voice: false },
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
  }),
  setSessionLead: setSessionLeadMock,
  setSessionMode: vi.fn(async () => {}),
}));

vi.mock('@/lib/agent/lead', () => ({
  getLead: getLeadMock,
}));

import { runAgentTurn } from '@/lib/agent/run-turn';

function fakeRunner(finalContent: Array<{ type: string; [k: string]: unknown }>, fullMessages: Array<{ role: string; content: unknown }>) {
  return {
    done: vi.fn(async () => ({ content: finalContent, usage: { input_tokens: 120, output_tokens: 40 } })),
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

    // Both the new inbound user message AND the assistant reply are persisted — not just the reply.
    expect(appendedMessages).toHaveLength(2);
    expect(appendedMessages[0]).toMatchObject({ role: 'user', content: 'hola' });
    expect(appendedMessages[1]).toMatchObject({ role: 'assistant', inputTokens: 120, outputTokens: 40 });
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
  });

  it('short-circuits with a canned reply and never calls the model when the org is over its daily budget', async () => {
    budgetRows.length = 0;
    budgetRows.push({ total: '999999' });

    const result = await runAgentTurn({ orgId: 'org-1', channel: 'whatsapp', externalId: '+51987654321', inboundText: 'hola' });

    expect(toolRunnerMock).not.toHaveBeenCalled();
    expect(result.replyText).toMatch(/asesor/i);
    expect(appendedMessages).toHaveLength(0);
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
});
