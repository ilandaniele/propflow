import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const WEB_SESSION_ID = '55555555-5555-5555-5555-555555555555';

const {
  createProspectLead,
  setSessionLead,
  setWebSessionPhone,
  getWhatsAppDisplayPhone,
  createHandoffCode,
  updateWhere,
  isNullSpy,
} = vi.hoisted(() => ({
  createProspectLead: vi.fn(async () => ({ id: 'lead-new', fullName: 'Prospecto web', phone: null, score: 0, intentTag: null })),
  setSessionLead: vi.fn(async () => {}),
  setWebSessionPhone: vi.fn(async () => {}),
  getWhatsAppDisplayPhone: vi.fn(async () => '+51999999999' as string | null),
  createHandoffCode: vi.fn(async () => ({ id: 'code-1', code: 'WEB-ABCDEF', kind: 'continue' }) as unknown),
  updateWhere: vi.fn(async () => {}),
  isNullSpy: vi.fn(),
}));

vi.mock('@/lib/agent/lead', () => ({
  createProspectLead,
  attributionToSource: () => ({ sourceRef: null, sourceMeta: {} }),
}));
vi.mock('@/lib/agent/session', () => ({ setSessionLead }));
vi.mock('@/lib/widget/web-session', () => ({ setWebSessionPhone }));
vi.mock('@/lib/widget/channel', () => ({ getWhatsAppDisplayPhone }));
vi.mock('@/lib/widget/handoff-codes', () => ({ createHandoffCode }));
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return { ...actual, isNull: (...args: unknown[]) => { isNullSpy(...args); return actual.isNull(...(args as Parameters<typeof actual.isNull>)); } };
});
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: (...args: unknown[]) => updateWhere(...args),
      })),
    })),
  },
}));

import { makeContinueOnWhatsappTool } from '@/lib/agent/tools/continue-on-whatsapp';
import { buildAgentTools } from '@/lib/agent/tools';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: ORG_ID,
    sessionId: SESSION_ID,
    channel: 'web',
    externalId: 'web:session',
    dryRun: false,
    leadIdRef: { current: null },
    attribution: null,
    webSessionId: WEB_SESSION_ID,
    ...overrides,
  };
}

describe('continue_on_whatsapp tool registration', () => {
  it('is not offered on whatsapp or voice — only on web', () => {
    const whatsappTools = buildAgentTools(makeCtx({ channel: 'whatsapp', externalId: '+51987654321', webSessionId: null }));
    const voiceTools = buildAgentTools(makeCtx({ channel: 'voice', webSessionId: null }));
    const webTools = buildAgentTools(makeCtx());

    const names = (tools: ReturnType<typeof buildAgentTools>) => tools.map((t) => (t as { name: string }).name);
    expect(names(whatsappTools)).not.toContain('continue_on_whatsapp');
    expect(names(voiceTools)).not.toContain('continue_on_whatsapp');
    expect(names(webTools)).toContain('continue_on_whatsapp');
  });
});

describe('continue_on_whatsapp tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWhatsAppDisplayPhone.mockResolvedValue('+51999999999');
    createHandoffCode.mockResolvedValue({ id: 'code-1', code: 'WEB-ABCDEF', kind: 'continue' });
    createProspectLead.mockResolvedValue({ id: 'lead-new', fullName: 'Prospecto web', phone: null, score: 0, intentTag: null });
  });

  it('dryRun never writes', async () => {
    const tool = makeContinueOnWhatsappTool(makeCtx({ dryRun: true }));
    const result = await tool.run({});
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('returns "un asesor te va a contactar" when the org has no WhatsApp display phone', async () => {
    getWhatsAppDisplayPhone.mockResolvedValueOnce(null);
    const tool = makeContinueOnWhatsappTool(makeCtx());
    const result = await tool.run({});
    expect(String(result)).toMatch(/asesor te va a contactar/i);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone (too short) via the input schema', () => {
    const tool = makeContinueOnWhatsappTool(makeCtx());
    const schema = (tool as unknown as { input_schema: { properties: { phone: { maxLength?: number; minLength?: number } } } }).input_schema;
    expect(schema.properties.phone.minLength).toBe(6);
  });

  it('never overwrites an existing lead phone — the DB update is guarded by isNull(phone)', async () => {
    const tool = makeContinueOnWhatsappTool(makeCtx());
    await tool.run({ phone: '987654321' });

    expect(setWebSessionPhone).toHaveBeenCalledWith(ORG_ID, WEB_SESSION_ID, '+987654321');
    expect(updateWhere).toHaveBeenCalledTimes(1);
    // The WHERE clause is guarded with isNull(crmLeads.phone) — never overwrites a phone already on file.
    expect(isNullSpy).toHaveBeenCalledTimes(1);
  });

  it('creates a continue handoff code scoped to leadId + webSessionId', async () => {
    const tool = makeContinueOnWhatsappTool(makeCtx());
    const result = await tool.run({ reason: 'questions' });
    expect(createHandoffCode).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      webSessionId: WEB_SESSION_ID,
      kind: 'continue',
      leadId: 'lead-new',
    }));
    expect(String(result)).toMatch(/te dejé un botón/i);
  });

  it('handles the daily code cap gracefully (createHandoffCode → null)', async () => {
    createHandoffCode.mockResolvedValueOnce(null);
    const tool = makeContinueOnWhatsappTool(makeCtx());
    const result = await tool.run({});
    expect(String(result)).toMatch(/varios pedidos hoy/i);
  });
});

// book_visit's web branch (createHandoffCode kind:'visit', bookVisit never
// called) is covered in tests/unit/agent/tools/visit-tools.test.ts, which
// already has the full get-available-slots/visits/service mock setup that
// module needs — not duplicated here.
