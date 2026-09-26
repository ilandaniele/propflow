import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_SESSION_ID = '99999999-9999-9999-9999-999999999999';
const PROFILE_ID = '33333333-3333-3333-3333-333333333333';
const LISTING_ID = '44444444-4444-4444-4444-444444444444';

const {
  getListingDetails,
  getAvailableSlotsForOrg,
  isSlotStillAvailable,
  getOrCreateAgentConfig,
  bookVisit,
  rescheduleVisit,
  cancelVisit,
  listLeadActiveVisits,
  createProspectLead,
  setSessionLead,
  applyLeadQualification,
  createHandoffCode,
  enqueueJob,
  recordAgentEvent,
  dbSelectRows,
} = vi.hoisted(() => ({
  getListingDetails: vi.fn(async () => ({ id: LISTING_ID, title: 'Depa Sol' }) as unknown),
  getAvailableSlotsForOrg: vi.fn(async () => ({ timezone: 'America/Lima', slots: [] as unknown[], loadByProfile: {} })),
  isSlotStillAvailable: vi.fn(async () => true),
  getOrCreateAgentConfig: vi.fn(async () => ({ timezone: 'America/Lima' }) as unknown),
  bookVisit: vi.fn(async () => ({ ok: true, visit: { id: 'visit-1' } }) as unknown),
  rescheduleVisit: vi.fn(async () => ({ ok: true, visit: { id: 'visit-2' } }) as unknown),
  cancelVisit: vi.fn(async () => ({ ok: true }) as unknown),
  listLeadActiveVisits: vi.fn(async () => [] as unknown[]),
  createProspectLead: vi.fn(async () => ({ id: 'lead-new', fullName: 'x', phone: null, score: 0, intentTag: null })),
  setSessionLead: vi.fn(async () => {}),
  applyLeadQualification: vi.fn(async () => ({ id: 'lead-x', score: 1, intentTag: 'cold' })),
  createHandoffCode: vi.fn(async () => ({ id: 'code-1', code: 'WEB-ABCDEF', kind: 'visit' }) as unknown),
  enqueueJob: vi.fn(async () => 'job-1'),
  recordAgentEvent: vi.fn(async () => {}),
  dbSelectRows: [] as unknown[],
}));

vi.mock('@/lib/agent/listings', () => ({ getListingDetails }));
vi.mock('@/lib/agent/visits/availability', () => ({ getAvailableSlotsForOrg, isSlotStillAvailable }));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/visits/service', () => ({ bookVisit, rescheduleVisit, cancelVisit, listLeadActiveVisits }));
vi.mock('@/lib/agent/lead', () => ({
  createProspectLead,
  applyLeadQualification,
  attributionToSource: (a: unknown) => (a ? { sourceRef: 'ref:X', sourceMeta: a as Record<string, unknown> } : { sourceRef: null, sourceMeta: {} }),
}));
vi.mock('@/lib/agent/session', () => ({ setSessionLead }));
vi.mock('@/lib/widget/handoff-codes', () => ({ createHandoffCode, VOICE_CODE_TTL_MS: 2 * 3600_000 }));
vi.mock('@/lib/agent/jobs', () => ({ enqueueJob }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => dbSelectRows) })),
      })),
    })),
  },
}));

import { encodeSlotId } from '@/lib/agent/visits/slot-id';
import { makeGetAvailableSlotsTool } from '@/lib/agent/tools/get-available-slots';
import { makeBookVisitTool } from '@/lib/agent/tools/book-visit';
import { makeGetMyVisitsTool } from '@/lib/agent/tools/get-my-visits';
import { makeRescheduleVisitTool } from '@/lib/agent/tools/reschedule-visit';
import { makeCancelVisitTool } from '@/lib/agent/tools/cancel-visit';
import { makeUpdateLeadProfileTool } from '@/lib/agent/tools/update-lead-profile';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: ORG_ID,
    sessionId: SESSION_ID,
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: 'lead-1' },
    attribution: null,
    // Phase 7 override note (types.ts is item A's file; not touched here):
    // AgentToolContext.webSessionId is required — null outside the web channel.
    webSessionId: null,
    // Phase 8: null outside the voice channel (context.ts, item A).
    voiceCallId: null,
    shadowMode: false,
    whatsappConversationId: null,
    ...overrides,
  };
}

function validSlotId(sessionId = SESSION_ID) {
  return encodeSlotId(
    { profileId: PROFILE_ID, listingId: LISTING_ID, startsAt: new Date('2026-10-05T14:00:00.000Z'), visitMinutes: 45 },
    { orgId: ORG_ID, sessionId },
  );
}

describe('get_available_slots tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectRows.length = 0;
    getListingDetails.mockResolvedValue({ id: LISTING_ID, title: 'Depa Sol' });
    getAvailableSlotsForOrg.mockResolvedValue({ timezone: 'America/Lima', slots: [], loadByProfile: {} });
  });

  it('says nothing found when the listing does not exist for this org', async () => {
    getListingDetails.mockResolvedValueOnce(null);
    const tool = makeGetAvailableSlotsTool(makeCtx());
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/no se encontró/i);
  });

  it('suggests handoff_to_human when there are no slots', async () => {
    const tool = makeGetAvailableSlotsTool(makeCtx());
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/visit_scheduling/);
  });

  it('converts fromDate as a local (org timezone) calendar date, not UTC midnight', async () => {
    const tool = makeGetAvailableSlotsTool(makeCtx());
    await tool.run({ listingId: LISTING_ID, fromDate: '2026-10-05' });
    // America/Lima is UTC-5 — local midnight on 2026-10-05 is 2026-10-05T05:00:00Z, not 2026-10-05T00:00:00Z.
    expect(getAvailableSlotsForOrg).toHaveBeenCalledWith(
      expect.objectContaining({ from: new Date('2026-10-05T05:00:00.000Z') }),
    );
  });

  it('returns opaque slot ids the model can pass straight to book_visit', async () => {
    getAvailableSlotsForOrg.mockResolvedValueOnce({
      timezone: 'America/Lima',
      slots: [{ profileId: PROFILE_ID, startsAt: new Date('2026-10-05T14:00:00.000Z'), endsAt: new Date('2026-10-05T14:45:00.000Z'), bufferMinutes: 15 }],
      loadByProfile: { [PROFILE_ID]: 0 },
    });
    const tool = makeGetAvailableSlotsTool(makeCtx());
    const result = String(await tool.run({ listingId: LISTING_ID }));
    expect(result).toMatch(/^sl_/m);
    expect(result).not.toContain(PROFILE_ID);
  });
});

describe('book_visit tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectRows.length = 0;
    bookVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-1' } });
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima', channelsEnabled: { whatsapp: true } });
    getListingDetails.mockResolvedValue({ id: LISTING_ID, title: 'Depa Sol' });
    isSlotStillAvailable.mockResolvedValue(true);
    createHandoffCode.mockResolvedValue({ id: 'code-1', code: 'WEB-ABCDEF', kind: 'visit' });
  });

  it('rejects an altered slot id without calling bookVisit', async () => {
    const tool = makeBookVisitTool(makeCtx());
    const result = await tool.run({ slotId: `${validSlotId()}xx` });
    expect(String(result)).toMatch(/no es válido/i);
    expect(bookVisit).not.toHaveBeenCalled();
  });

  it('rejects a slot id bound to a different session without calling bookVisit', async () => {
    const tool = makeBookVisitTool(makeCtx());
    const result = await tool.run({ slotId: validSlotId(OTHER_SESSION_ID) });
    expect(String(result)).toMatch(/no es válido/i);
    expect(bookVisit).not.toHaveBeenCalled();
  });

  it('dryRun never writes', async () => {
    const tool = makeBookVisitTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ slotId: validSlotId() });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(bookVisit).not.toHaveBeenCalled();
  });

  it('web channel with no webSessionId falls back to the "coordinate by WhatsApp" rejection, without calling bookVisit or createHandoffCode', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'web', webSessionId: null }));
    const result = await tool.run({ slotId: validSlotId() });
    expect(String(result)).toMatch(/whatsapp/i);
    expect(bookVisit).not.toHaveBeenCalled();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('web channel: issues a visit handoff code and never calls bookVisit directly', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'web', webSessionId: 'web-session-1', leadIdRef: { current: null } }));
    const result = await tool.run({ slotId: validSlotId() });

    expect(bookVisit).not.toHaveBeenCalled();
    expect(createHandoffCode).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      webSessionId: 'web-session-1',
      kind: 'visit',
      listingId: LISTING_ID,
      profileId: PROFILE_ID,
      leadId: 'lead-new',
    }));
    expect(String(result)).toMatch(/vence en 30 min/i);
  });

  it('web channel: the daily handoff-code cap (createHandoffCode → null) is handled gracefully', async () => {
    createHandoffCode.mockResolvedValueOnce(null);
    const tool = makeBookVisitTool(makeCtx({ channel: 'web', webSessionId: 'web-session-1' }));
    const result = await tool.run({ slotId: validSlotId() });
    expect(String(result)).toMatch(/varios pedidos hoy/i);
    expect(bookVisit).not.toHaveBeenCalled();
  });

  it('voice channel: rejects with the "coordinate by WhatsApp" message, without calling bookVisit or createHandoffCode', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'voice' }));
    const result = await tool.run({ slotId: validSlotId() });
    expect(String(result)).toMatch(/whatsapp/i);
    expect(bookVisit).not.toHaveBeenCalled();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('offers alternatives when the slot was just taken', async () => {
    bookVisit.mockResolvedValueOnce({ ok: false, reason: 'slot_taken' });
    getAvailableSlotsForOrg.mockResolvedValueOnce({
      timezone: 'America/Lima',
      slots: [{ profileId: PROFILE_ID, startsAt: new Date('2026-10-06T14:00:00.000Z'), endsAt: new Date('2026-10-06T14:45:00.000Z'), bufferMinutes: 15 }],
      loadByProfile: {},
    });
    const tool = makeBookVisitTool(makeCtx());
    const result = String(await tool.run({ slotId: validSlotId() }));
    expect(result).toMatch(/se acaba de ocupar/i);
    expect(result).toMatch(/sl_/);
  });

  it('rejects a stale slot (isSlotStillAvailable false) and offers alternatives, without calling bookVisit', async () => {
    isSlotStillAvailable.mockResolvedValueOnce(false);
    getAvailableSlotsForOrg.mockResolvedValueOnce({
      timezone: 'America/Lima',
      slots: [{ profileId: PROFILE_ID, startsAt: new Date('2026-10-06T14:00:00.000Z'), endsAt: new Date('2026-10-06T14:45:00.000Z'), bufferMinutes: 15 }],
      loadByProfile: {},
    });
    const tool = makeBookVisitTool(makeCtx());
    const result = String(await tool.run({ slotId: validSlotId() }));
    expect(result).toMatch(/ya no está disponible/i);
    expect(result).toMatch(/sl_/);
    expect(bookVisit).not.toHaveBeenCalled();
  });

  it('never passes a lead the model chose — always ctx.leadIdRef.current via ensureLead', async () => {
    const ctx = makeCtx({ leadIdRef: { current: null } });
    const tool = makeBookVisitTool(ctx);
    await tool.run({ slotId: validSlotId(), fullName: 'Juan' });
    expect(createProspectLead).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, fullName: 'Juan' }));
    expect(bookVisit).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-new' }));
  });
});

describe('book_visit tool — voice branch (item B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectRows.length = 0;
    bookVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-1' } });
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima', channelsEnabled: { whatsapp: true } });
    getListingDetails.mockResolvedValue({ id: LISTING_ID, title: 'Depa Sol' });
    isSlotStillAvailable.mockResolvedValue(true);
    createHandoffCode.mockResolvedValue({ id: 'code-voz-1', code: 'VOZ-ABCDEF', kind: 'visit' });
  });

  it('with no voiceCallId, falls back to the old "coordinate by WhatsApp" rejection (unrelated to the voice branch)', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'voice', voiceCallId: null }));
    const result = await tool.run({ slotId: validSlotId() });
    expect(String(result)).toMatch(/whatsapp/i);
    expect(bookVisit).not.toHaveBeenCalled();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('a verified caller phone + WhatsApp enabled: issues a VOZ- handoff code and enqueues the confirmation job, never calling bookVisit', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'voice', voiceCallId: 'call-1', externalId: '+51987654321', leadIdRef: { current: null } }));
    const result = await tool.run({ slotId: validSlotId() });

    expect(bookVisit).not.toHaveBeenCalled();
    expect(createHandoffCode).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      source: 'voice',
      kind: 'visit',
      callId: 'call-1',
      targetPhone: '+51987654321',
      leadId: 'lead-new',
      listingId: LISTING_ID,
      profileId: PROFILE_ID,
    }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      kind: 'voice.visit_confirmation_message',
      payload: { codeId: 'code-voz-1' },
    }));
    expect(String(result)).toMatch(/whatsapp/i);
  });

  it('no verified phone (call:<vapiCallId> externalId) → handoff to a human, no code issued', async () => {
    const tool = makeBookVisitTool(makeCtx({ channel: 'voice', voiceCallId: 'call-1', externalId: 'call:8f14e45f-ceea' }));
    const result = await tool.run({ slotId: validSlotId() });

    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(bookVisit).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/un asesor/i);
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'handoff', data: { reason: 'voice_booking' } }));
  });

  it('WhatsApp disabled → handoff to a human even with a verified caller phone', async () => {
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima', channelsEnabled: { whatsapp: false } });
    const tool = makeBookVisitTool(makeCtx({ channel: 'voice', voiceCallId: 'call-1', externalId: '+51987654321' }));
    const result = await tool.run({ slotId: validSlotId() });

    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/un asesor/i);
  });
});

describe('get_my_visits tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima' });
  });

  it('says there are none without a lead yet', async () => {
    const tool = makeGetMyVisitsTool(makeCtx({ leadIdRef: { current: null } }));
    const result = await tool.run({});
    expect(String(result)).toMatch(/no tenés visitas/i);
    expect(listLeadActiveVisits).not.toHaveBeenCalled();
  });

  it('lists the lead active visits, scoped to ctx.leadIdRef.current', async () => {
    listLeadActiveVisits.mockResolvedValueOnce([
      { id: 'visit-1', listingTitle: 'Depa Sol', startsAt: new Date('2026-10-05T14:00:00.000Z') },
    ]);
    const tool = makeGetMyVisitsTool(makeCtx({ leadIdRef: { current: 'lead-1' } }));
    const result = String(await tool.run({}));
    expect(listLeadActiveVisits).toHaveBeenCalledWith(ORG_ID, 'lead-1');
    expect(result).toContain('visit-1');
    expect(result).toContain('Depa Sol');
  });
});

describe('reschedule_visit tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima' });
    rescheduleVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-2' } });
    isSlotStillAvailable.mockResolvedValue(true);
  });

  it('rejects an invalid slot id without calling rescheduleVisit', async () => {
    const tool = makeRescheduleVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1', slotId: `${validSlotId()}xx` });
    expect(String(result)).toMatch(/no es válido/i);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });

  it('rejects a stale slot (isSlotStillAvailable false) without calling rescheduleVisit', async () => {
    isSlotStillAvailable.mockResolvedValueOnce(false);
    const tool = makeRescheduleVisitTool(makeCtx());
    const result = await tool.run({ visitId: 'visit-1', slotId: validSlotId() });
    expect(String(result)).toMatch(/se acaba de ocupar/i);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });

  it('says not found without a lead in this session', async () => {
    const tool = makeRescheduleVisitTool(makeCtx({ leadIdRef: { current: null } }));
    const result = await tool.run({ visitId: 'visit-1', slotId: validSlotId() });
    expect(String(result)).toMatch(/no encontré/i);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });

  it('always passes ctx.leadIdRef.current, never a lead from the model', async () => {
    const tool = makeRescheduleVisitTool(makeCtx({ leadIdRef: { current: 'lead-only-mine' } }));
    await tool.run({ visitId: 'visit-1', slotId: validSlotId() });
    expect(rescheduleVisit).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-only-mine', actor: 'agent' }));
  });

  it('does not write on the web channel', async () => {
    const tool = makeRescheduleVisitTool(makeCtx({ channel: 'web' }));
    const result = await tool.run({ visitId: 'visit-1', slotId: validSlotId() });
    expect(String(result)).toMatch(/whatsapp/i);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });

  it('dryRun never writes', async () => {
    const tool = makeRescheduleVisitTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ visitId: 'visit-1', slotId: validSlotId() });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(rescheduleVisit).not.toHaveBeenCalled();
  });
});

describe('cancel_visit tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelVisit.mockResolvedValue({ ok: true });
  });

  it('says not found without a lead in this session', async () => {
    const tool = makeCancelVisitTool(makeCtx({ leadIdRef: { current: null } }));
    const result = await tool.run({ visitId: 'visit-1' });
    expect(String(result)).toMatch(/no encontré/i);
    expect(cancelVisit).not.toHaveBeenCalled();
  });

  it('always passes ctx.leadIdRef.current, never a lead from the model', async () => {
    const tool = makeCancelVisitTool(makeCtx({ leadIdRef: { current: 'lead-only-mine' } }));
    await tool.run({ visitId: 'visit-1', reason: 'cambió de planes' });
    expect(cancelVisit).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-only-mine', actor: 'agent', visitId: 'visit-1' }));
  });

  it('dryRun never writes', async () => {
    const tool = makeCancelVisitTool(makeCtx({ dryRun: true, leadIdRef: { current: 'lead-1' } }));
    const result = await tool.run({ visitId: 'visit-1' });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(cancelVisit).not.toHaveBeenCalled();
  });
});

describe('visit tool schemas never accept orgId/leadId/profileId from the model', () => {
  it('get_available_slots / book_visit / get_my_visits / reschedule_visit / cancel_visit', () => {
    const ctx = makeCtx();
    const tools = [
      makeGetAvailableSlotsTool(ctx),
      makeBookVisitTool(ctx),
      makeGetMyVisitsTool(ctx),
      makeRescheduleVisitTool(ctx),
      makeCancelVisitTool(ctx),
    ];
    for (const tool of tools) {
      const properties = (tool.input_schema as unknown as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties)).not.toContain('orgId');
      expect(Object.keys(properties)).not.toContain('leadId');
      expect(Object.keys(properties)).not.toContain('profileId');
    }
  });
});

describe('update_lead_profile tool still works after the ensureLead refactor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a lead on first write and reuses it afterwards', async () => {
    const ctx = makeCtx({ leadIdRef: { current: null } });
    const tool = makeUpdateLeadProfileTool(ctx);

    await tool.run({ operationType: 'rent' });
    expect(createProspectLead).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, phone: '+51987654321', sourceChannel: 'whatsapp' }));
    expect(setSessionLead).toHaveBeenCalledWith(SESSION_ID, 'lead-new');
    expect(ctx.leadIdRef.current).toBe('lead-new');
    expect(applyLeadQualification).toHaveBeenCalledWith(ORG_ID, 'lead-new', expect.objectContaining({ operationType: 'rent' }));

    await tool.run({ zones: ['Miraflores'] });
    expect(createProspectLead).toHaveBeenCalledTimes(1);
    expect(applyLeadQualification).toHaveBeenCalledWith(ORG_ID, 'lead-new', expect.objectContaining({ zones: ['Miraflores'] }));
  });
});
