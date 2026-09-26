/**
 * Integration tests for POST /api/agent/voice/vapi (item B, blueprint §3-4).
 * Fixtures under tests/fixtures/vapi/*.json (item A) are reused verbatim so
 * the request bodies match the real Vapi envelope shape B built against.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import assistantRequestFixture from '../../fixtures/vapi/assistant-request.json';
import toolCallsFixture from '../../fixtures/vapi/tool-calls.json';
import endOfCallFixture from '../../fixtures/vapi/end-of-call-report.json';

const SECRET = 'test-vapi-secret';
process.env.VAPI_WEBHOOK_SECRET = SECRET;

const ORG_ID = '11111111-2222-3333-4444-555555555555';
const PHONE_NUMBER_ID = 'aa1bb2cc-3333-4444-5555-666677778888';
const VAPI_CALL_ID = '8f14e45f-ceea-467e-8a0c-ea3d63a3f5b1';

const {
  calls,
  logCalls,
  getVoiceChannelByPhoneNumberId,
  createCallRow,
  getCallByVapiId,
  getCallById,
  transitionCall,
  getOrCreateAgentConfig,
  getMonthlyVoiceUsage,
  getOrCreateSession,
  getSessionById,
  buildVapiAssistant,
  buildRefusalAssistant,
  buildAgentTools,
  toolRun,
} = vi.hoisted(() => {
  const calls = new Map<string, Record<string, unknown>>();
  return {
    calls,
    logCalls: [] as unknown[][],
    getVoiceChannelByPhoneNumberId: vi.fn(),
    createCallRow: vi.fn(),
    getCallByVapiId: vi.fn(async (vapiCallId: string) => calls.get(`vapi:${vapiCallId}`) ?? null),
    getCallById: vi.fn(async (orgId: string, id: string) => {
      const row = calls.get(id);
      return row && row.orgId === orgId ? row : null;
    }),
    transitionCall: vi.fn(async (id: string, from: string[], patch: Record<string, unknown>) => {
      const row = calls.get(id);
      if (!row || !from.includes(row.status as string)) return null;
      Object.assign(row, patch);
      return row;
    }),
    getOrCreateAgentConfig: vi.fn(),
    getMonthlyVoiceUsage: vi.fn(async () => ({ usedMinutes: 0, inFlightCalls: 0 })),
    getOrCreateSession: vi.fn(),
    getSessionById: vi.fn(),
    buildVapiAssistant: vi.fn(async () => ({ firstMessage: 'Hola, soy Ana.', model: { provider: 'anthropic', model: 'x', maxTokens: 300, messages: [], tools: [] }, voice: { provider: 'azure', voiceId: 'x' }, transcriber: { provider: 'deepgram', model: 'nova-3', language: 'es' }, maxDurationSeconds: 600 })),
    buildRefusalAssistant: vi.fn((o: { reason: string }) => ({ firstMessage: `REFUSAL:${o.reason}`, model: { provider: 'anthropic', model: 'x', maxTokens: 60, messages: [], tools: [] }, voice: { provider: 'azure', voiceId: 'x' }, transcriber: { provider: 'deepgram', model: 'nova-3', language: 'es' }, maxDurationSeconds: 20 })),
    buildAgentTools: vi.fn(),
    toolRun: { slow: false },
  };
});

function makeCallRow(a: Record<string, unknown>): Record<string, unknown> {
  const id = `call-row-${calls.size + 1}`;
  const row: Record<string, unknown> = {
    id,
    orgId: a.orgId,
    sessionId: a.sessionId ?? null,
    leadId: a.leadId ?? null,
    visitId: null,
    direction: a.direction,
    purpose: a.purpose,
    status: a.status ?? 'queued',
    vapiCallId: a.vapiCallId ?? null,
    customerPhone: a.customerPhone ?? null,
    startedAt: null,
    endedAt: null,
    durationSeconds: null,
    outcome: null,
    summary: null,
    costUsd: null,
    createdAt: new Date(),
  };
  calls.set(id, row);
  if (a.vapiCallId) calls.set(`vapi:${a.vapiCallId}`, row);
  return row;
}

vi.mock('@/lib/agent/voice/calls', () => ({
  getVoiceChannelByPhoneNumberId,
  createCallRow,
  getCallByVapiId,
  getCallById,
  transitionCall,
}));
vi.mock('@/lib/agent/voice/usage', () => ({
  getMonthlyVoiceUsage,
  checkMinuteCap: (a: { usedMinutes: number; inFlightCalls: number; capMinutes: number; maxCallMinutes: number; direction: string }) =>
    a.direction === 'outbound'
      ? a.usedMinutes + a.inFlightCalls * a.maxCallMinutes + a.maxCallMinutes <= a.capMinutes
      : a.usedMinutes + a.inFlightCalls * a.maxCallMinutes < a.capMinutes,
}));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/session', () => ({ getOrCreateSession, getSessionById }));
vi.mock('@/lib/agent/lead', () => ({ getLead: vi.fn(async () => null) }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/agent/voice/assistant', () => ({
  buildVapiAssistant,
  buildRefusalAssistant,
  buildTimeoutFallbackAssistant: () => ({
    firstMessage: 'Estamos con demoras técnicas — te transfiero con un asesor humano.',
    model: { provider: 'anthropic', model: 'x', maxTokens: 60, messages: [], tools: [] },
    voice: { provider: 'azure', voiceId: 'x' },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'es' },
    maxDurationSeconds: 20,
  }),
  vapiServerUrl: () => 'https://app.example.com/api/agent/voice/vapi',
}));
vi.mock('@/lib/agent/tools', () => ({ buildAgentTools }));
vi.mock('@/lib/agent/tools/channels', () => ({ isToolEnabledForChannel: () => true }));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ name: 'Inmobiliaria Test' }] }) }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock('@/lib/log', () => ({
  log: {
    error: (...args: unknown[]) => logCalls.push(args),
    warn: (...args: unknown[]) => logCalls.push(args),
    info: (...args: unknown[]) => logCalls.push(args),
  },
}));

import { POST } from '@/app/api/agent/voice/vapi/route';

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://app.example.com/api/agent/voice/vapi', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent/voice/vapi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.clear();
    logCalls.length = 0;
    toolRun.slow = false;

    getVoiceChannelByPhoneNumberId.mockResolvedValue({ orgId: ORG_ID, channelId: 'chan-1', phoneNumberId: PHONE_NUMBER_ID, displayPhoneE164: '+14155550199' });
    createCallRow.mockImplementation(async (a: Record<string, unknown>) => makeCallRow(a));
    getOrCreateAgentConfig.mockResolvedValue({
      persona: 'Ana',
      timezone: 'America/Lima',
      channelsEnabled: { whatsapp: true, web: true, voice: true },
      voice: { monthlyMinuteCap: 300, maxCallMinutes: 10 },
    });
    getMonthlyVoiceUsage.mockResolvedValue({ usedMinutes: 0, inFlightCalls: 0 });
    getOrCreateSession.mockResolvedValue({ id: 'session-1', mode: 'ai', leadId: null, externalId: '+14155550101', attribution: null });
    getSessionById.mockResolvedValue({ id: 'session-1', mode: 'ai', leadId: null, externalId: '+14155550101', attribution: null });
    buildAgentTools.mockReturnValue([
      { type: 'custom', name: 'lookup_tenant_by_phone', description: 'x', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'inquilino: Maria' },
      {
        type: 'custom',
        name: 'create_maintenance_ticket',
        description: 'x',
        input_schema: { type: 'object', properties: {} },
        parse: (a: unknown) => a,
        run: async () => {
          if (toolRun.slow) return new Promise(() => {}); // never resolves — exercises the timeout path
          return 'ticket creado';
        },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('auth', () => {
    it('401s with no secret header', async () => {
      const res = await POST(makeRequest(assistantRequestFixture));
      expect(res.status).toBe(401);
    });

    it('401s with a wrong secret', async () => {
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': 'wrong' }));
      expect(res.status).toBe(401);
    });

    it('accepts X-Vapi-Secret', async () => {
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(200);
    });

    it('accepts Authorization: Bearer', async () => {
      const res = await POST(makeRequest(assistantRequestFixture, { authorization: `Bearer ${SECRET}` }));
      expect(res.status).toBe(200);
    });
  });

  describe('assistant-request', () => {
    it('unknown phoneNumberId → refusal, no call row created', async () => {
      getVoiceChannelByPhoneNumberId.mockResolvedValue(null);
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      const body = await res.json();
      expect(body.assistant.firstMessage).toBe('REFUSAL:disabled');
      expect(createCallRow).not.toHaveBeenCalled();
    });

    it('voice disabled for the org → refusal', async () => {
      getOrCreateAgentConfig.mockResolvedValue({
        persona: 'Ana', timezone: 'America/Lima',
        channelsEnabled: { whatsapp: true, web: true, voice: false },
        voice: { monthlyMinuteCap: 300, maxCallMinutes: 10 },
      });
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      const body = await res.json();
      expect(body.assistant.firstMessage).toBe('REFUSAL:disabled');
      expect(createCallRow).not.toHaveBeenCalled();
    });

    it('over the monthly minute cap → refusal', async () => {
      getMonthlyVoiceUsage.mockResolvedValue({ usedMinutes: 300, inFlightCalls: 0 });
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      const body = await res.json();
      expect(body.assistant.firstMessage).toBe('REFUSAL:cap');
      expect(createCallRow).not.toHaveBeenCalled();
    });

    it('creates the call row and session, returns a real assistant', async () => {
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.assistant.firstMessage).toBe('Hola, soy Ana.');
      expect(getOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, channel: 'voice', externalId: '+14155550101' }));
      expect(createCallRow).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, direction: 'inbound', purpose: 'inbound', vapiCallId: VAPI_CALL_ID }));
    });

    it('item 9: passes buildVapiAssistant the already-loaded config/session/orgName instead of forcing it to reload them', async () => {
      await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      expect(buildVapiAssistant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preloaded: expect.objectContaining({
            config: expect.objectContaining({ persona: 'Ana' }),
            session: expect.objectContaining({ id: 'session-1' }),
            orgName: 'Inmobiliaria Test',
          }),
        }),
      );
    });

    it('item 9: falls back to a refusal/handoff assistant if the handler is too slow (budget exceeded)', async () => {
      vi.useFakeTimers();
      buildVapiAssistant.mockImplementation(() => new Promise(() => {})); // never resolves

      const promise = POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      await vi.advanceTimersByTimeAsync(6000);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.assistant.model.tools).toEqual([]);
      expect(body.assistant.firstMessage.toLowerCase()).toMatch(/asesor humano|demoras/);
    });
  });

  describe('tool-calls', () => {
    async function seedInProgressCall() {
      makeCallRow({ orgId: ORG_ID, sessionId: 'session-1', leadId: null, direction: 'inbound', purpose: 'inbound', status: 'in_progress', vapiCallId: VAPI_CALL_ID });
    }

    it('answers every call and keeps toolCallId order', async () => {
      await seedInProgressCall();
      const res = await POST(makeRequest(toolCallsFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([
        { toolCallId: 'toolcall-01hz3n8k9qxjq0a1b2c3d4e5f6', result: 'inquilino: Maria' },
        { toolCallId: 'toolcall-01hz3n8k9qxjq0a1b2c3d4e5f7', result: 'ticket creado' },
      ]);
    });

    it('a slow tool times out within the shared budget and still answers 200', async () => {
      vi.useFakeTimers();
      await seedInProgressCall();
      toolRun.slow = true;

      const promise = POST(makeRequest(toolCallsFixture, { 'x-vapi-secret': SECRET }));
      await vi.advanceTimersByTimeAsync(6500);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results[0]).toEqual({ toolCallId: 'toolcall-01hz3n8k9qxjq0a1b2c3d4e5f6', result: 'inquilino: Maria' });
      expect(body.results[1].result).toMatch(/no pude verificarlo ahora/i);
    });

    it('an unresolvable call (no matching agent_calls row) still answers 200 with a safe timeout text for every call', async () => {
      const res = await POST(makeRequest(toolCallsFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(2);
      for (const r of body.results) expect(r.result).toMatch(/no pude verificarlo ahora/i);
    });

    it('item 10: a tool that resolves a lead mid-call persists it onto agent_calls when it was null before', async () => {
      await seedInProgressCall();
      // Production wiring hands each tool a shared toolCtx (including leadIdRef)
      // via buildAgentTools' ctx argument — a tool mutates ctx.leadIdRef.current
      // to report a lead it just created/resolved. Simulated here at the same
      // seam: buildAgentTools receives the real toolCtx built by the handler.
      buildAgentTools.mockImplementation((ctx: { leadIdRef: { current: string | null } }) => {
        ctx.leadIdRef.current = 'lead-99';
        return [
          { type: 'custom', name: 'lookup_tenant_by_phone', description: 'x', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'inquilino: Maria' },
          { type: 'custom', name: 'create_maintenance_ticket', description: 'x', input_schema: { type: 'object', properties: {} }, parse: (a: unknown) => a, run: async () => 'ticket creado' },
        ];
      });

      const res = await POST(makeRequest(toolCallsFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(200);

      const callRow = [...calls.values()].find((r) => r.vapiCallId === VAPI_CALL_ID);
      expect(callRow?.leadId).toBe('lead-99');
    });
  });

  describe('end-of-call-report', () => {
    it('delivered twice only updates the row once', async () => {
      makeCallRow({ orgId: ORG_ID, sessionId: 'session-1', leadId: null, direction: 'inbound', purpose: 'inbound', status: 'in_progress', vapiCallId: VAPI_CALL_ID });

      const res1 = await POST(makeRequest(endOfCallFixture, { 'x-vapi-secret': SECRET }));
      expect(res1.status).toBe(200);
      expect(transitionCall).toHaveBeenCalledTimes(1);

      const res2 = await POST(makeRequest(endOfCallFixture, { 'x-vapi-secret': SECRET }));
      expect(res2.status).toBe(200);
      // Second delivery finds the row already 'ended' and short-circuits before calling transitionCall again.
      expect(transitionCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('no PII in logs', () => {
    it('never logs a phone number, transcript or recording URL, even when a handler throws', async () => {
      getOrCreateSession.mockRejectedValue(new Error('boom'));
      const res = await POST(makeRequest(assistantRequestFixture, { 'x-vapi-secret': SECRET }));
      expect(res.status).toBe(500);

      const serialized = JSON.stringify(logCalls);
      expect(serialized).not.toContain('+14155550101');
      expect(serialized).not.toContain('recordingUrl');
      expect(serialized).not.toContain('storage.vapi.ai');
    });
  });
});
