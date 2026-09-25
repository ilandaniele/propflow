import { describe, it, expect, vi, beforeEach } from 'vitest';

const CONFIG_FIXTURE = {
  id: 'config-1',
  orgId: 'org-1',
  persona: 'Ana',
  tone: 'profesional' as const,
  rules: null,
  prohibited: null,
  faq: [],
  businessHours: { weekly: [], closedNote: null },
  timezone: 'America/Lima',
  qualificationFields: ['operation_type'],
  followupPolicy: {},
  routingMode: 'round_robin' as const,
  dailyTokenBudget: 50_000,
  widgetAllowedOrigins: [],
  channelsEnabled: { whatsapp: true, web: false, voice: true },
  shadowMode: false,
  maxAgentTurns: null,
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

const { buildAgentToolsMock, getSessionByIdMock, getLeadMock } = vi.hoisted(() => ({
  buildAgentToolsMock: vi.fn(() => [
    { type: 'custom', name: 'search_listings', description: 'buscar', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'ok' },
    { type: 'custom', name: 'send_listing_photos', description: 'fotos (whatsapp only)', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'ok' },
    { type: 'custom', name: 'continue_on_whatsapp', description: 'web only', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'ok' },
    { type: 'custom', name: 'book_visit', description: 'reservar', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'ok' },
  ]),
  getSessionByIdMock: vi.fn(async () => ({ id: 'session-1', externalId: '+51987654321' })),
  getLeadMock: vi.fn(async () => null),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ name: 'Inmobiliaria Test' }],
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn(async () => CONFIG_FIXTURE),
}));

vi.mock('@/lib/agent/session', () => ({
  getSessionById: getSessionByIdMock,
}));

vi.mock('@/lib/agent/lead', () => ({
  getLead: getLeadMock,
}));

vi.mock('@/lib/agent/tools', () => ({
  buildAgentTools: buildAgentToolsMock,
}));

import { buildVapiAssistant, buildRefusalAssistant, VOICE_DISCLOSURE } from '@/lib/agent/voice/assistant';

beforeEach(() => {
  vi.clearAllMocks();
  buildAgentToolsMock.mockClear();
});

describe('agent/voice/assistant — buildVapiAssistant', () => {
  const ctx = { orgId: 'org-1', callId: 'call-1', sessionId: 'session-1', leadId: null, customerPhone: '+51987654321', purpose: 'inbound' as const, visitId: null };

  it('the disclosure is always the first thing in firstMessage', async () => {
    const assistant = await buildVapiAssistant(ctx, { serverUrl: 'https://app.example.com/api/agent/voice/vapi' });
    expect(assistant.firstMessage.startsWith('Hola, soy Ana, un asistente virtual con inteligencia artificial de Inmobiliaria Test.')).toBe(true);
  });

  it('offers no tool outside TOOL_CHANNELS.voice (send_listing_photos and continue_on_whatsapp are excluded)', async () => {
    const assistant = await buildVapiAssistant(ctx, { serverUrl: 'https://app.example.com/api/agent/voice/vapi' });
    const names = assistant.model.tools?.map((t) => t.function.name) ?? [];
    expect(names).toContain('search_listings');
    expect(names).toContain('book_visit');
    expect(names).not.toContain('send_listing_photos');
    expect(names).not.toContain('continue_on_whatsapp');
  });

  it('never includes a phone number anywhere in the prompt', async () => {
    const assistant = await buildVapiAssistant(ctx, { serverUrl: 'https://app.example.com/api/agent/voice/vapi' });
    const systemText = assistant.model.messages[0]?.content ?? '';
    expect(systemText).not.toContain('+51987654321');
    expect(assistant.firstMessage).not.toContain('+51987654321');
  });

  it('the metadata carries agentCallId and orgId', async () => {
    const assistant = await buildVapiAssistant(ctx, { serverUrl: 'https://app.example.com/api/agent/voice/vapi' });
    expect(assistant.metadata).toEqual({ orgId: 'org-1', agentCallId: 'call-1' });
  });

  it('sets serverMessages, server.url and maxDurationSeconds from voice config', async () => {
    const assistant = await buildVapiAssistant(ctx, { serverUrl: 'https://app.example.com/api/agent/voice/vapi' });
    expect(assistant.serverMessages).toEqual(['tool-calls', 'end-of-call-report', 'status-update']);
    expect(assistant.server?.url).toBe('https://app.example.com/api/agent/voice/vapi');
    expect(assistant.maxDurationSeconds).toBe(600); // 10 min * 60
  });
});

describe('agent/voice/assistant — VOICE_DISCLOSURE', () => {
  it('appends the recording notice only when recording is enabled', () => {
    expect(VOICE_DISCLOSURE('Ana', 'Acme', true)).toContain('se graba');
    expect(VOICE_DISCLOSURE('Ana', 'Acme', false)).not.toContain('se graba');
  });
});

describe('agent/voice/assistant — buildRefusalAssistant', () => {
  it('has no tools and a short max duration', () => {
    const assistant = buildRefusalAssistant({ persona: 'Ana', orgName: 'Acme', reason: 'disabled' });
    expect(assistant.model.tools).toEqual([]);
    expect(assistant.maxDurationSeconds).toBe(20);
    expect(assistant.firstMessage).toContain('Hola, soy Ana');
  });
});
