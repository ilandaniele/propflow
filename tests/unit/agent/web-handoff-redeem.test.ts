import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org-1';
const WA_SESSION_ID = 'wa-session-1';
const PHONE = '+51987654321';

const {
  claimHandoffCode,
  finishHandoffCode,
  getLatestPendingVoiceCodeForPhone,
  getOrCreateAgentConfig,
  getListingDetails,
  bookVisit,
  setSessionLead,
  recordAgentEvent,
  updateSet,
  updateWhere,
  selectLimit,
} = vi.hoisted(() => ({
  claimHandoffCode: vi.fn(),
  finishHandoffCode: vi.fn(async () => {}),
  getLatestPendingVoiceCodeForPhone: vi.fn(async () => null as unknown),
  getOrCreateAgentConfig: vi.fn(async () => ({ timezone: 'America/Lima' })),
  getListingDetails: vi.fn(async () => ({ id: 'listing-1', title: 'Depa Sol' })),
  bookVisit: vi.fn(),
  setSessionLead: vi.fn(async () => {}),
  recordAgentEvent: vi.fn(async () => {}),
  updateSet: vi.fn(() => ({ where: updateWhereImpl })),
  updateWhere: vi.fn(async () => {}),
  selectLimit: vi.fn(async () => [] as Array<{ phone: string | null; sourceMeta: Record<string, unknown> | null }>),
}));

function updateWhereImpl(...args: unknown[]) {
  return updateWhere(...args);
}

vi.mock('@/lib/widget/handoff-codes', async () => {
  const actual = await vi.importActual<typeof import('@/lib/widget/handoff-codes')>('@/lib/widget/handoff-codes');
  return { ...actual, claimHandoffCode, finishHandoffCode, getLatestPendingVoiceCodeForPhone };
});
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/listings', () => ({ getListingDetails }));
vi.mock('@/lib/agent/visits/service', () => ({ bookVisit }));
vi.mock('@/lib/agent/session', () => ({ setSessionLead }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) })),
  },
}));

import { redeemWebHandoffCode } from '@/lib/agent/web-handoff-redeem';

const VISIT_CODE = {
  id: 'code-1',
  orgId: ORG_ID,
  webSessionId: 'web-session-1',
  code: 'WEB-ABCDEF',
  kind: 'visit' as const,
  leadId: 'lead-1',
  listingId: 'listing-1',
  profileId: 'profile-1',
  startsAt: new Date('2026-10-05T14:00:00.000Z'),
  visitMinutes: 45,
  status: 'redeemed' as const,
  expiresAt: new Date('2026-10-05T15:00:00.000Z'),
};

const CONTINUE_CODE = {
  ...VISIT_CODE,
  kind: 'continue' as const,
  listingId: null,
  profileId: null,
  startsAt: null,
  visitMinutes: null,
};

const VOICE_VISIT_CODE = {
  ...VISIT_CODE,
  id: 'code-voz-1',
  code: 'VOZ-ABCDEF',
  source: 'voice' as const,
  callId: 'call-1',
  targetPhone: PHONE,
  webSessionId: null,
};

describe('redeemWebHandoffCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bookVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-1' } });
    selectLimit.mockResolvedValue([]);
    getLatestPendingVoiceCodeForPhone.mockResolvedValue(null);
  });

  it('returns "none" when the text has no WEB-XXXXXX code', async () => {
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'hola, cómo estás',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome).toEqual({ kind: 'none' });
    expect(claimHandoffCode).not.toHaveBeenCalled();
  });

  it('returns "none" for a code that belongs to another org (claimHandoffCode → null)', async () => {
    claimHandoffCode.mockResolvedValue(null);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Confirmo. Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome).toEqual({ kind: 'none' });
  });

  it('returns "expired" for a code that was pending but past its TTL', async () => {
    claimHandoffCode.mockResolvedValue('expired');
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome.kind).toBe('expired');
    expect((outcome as { note: string }).note).toMatch(/venci/i);
  });

  it('books the visit with the verified WhatsApp phone and finishes the code redeemed', async () => {
    claimHandoffCode.mockResolvedValue(VISIT_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Confirmo mi visita. Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: 'lead-1' },
    });

    expect(bookVisit).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      leadId: 'lead-1',
      contactPhone: PHONE,
      sourceChannel: 'web',
      profileId: 'profile-1',
    }));
    expect(finishHandoffCode).toHaveBeenCalledWith('code-1', expect.objectContaining({ status: 'redeemed', visitId: 'visit-1' }));
    expect(outcome).toEqual(expect.objectContaining({ kind: 'visit_booked', visitId: 'visit-1' }));
  });

  it('slot_taken → visit_failed with a note for the agent to offer new slots', async () => {
    claimHandoffCode.mockResolvedValue(VISIT_CODE);
    bookVisit.mockResolvedValue({ ok: false, reason: 'slot_taken' });
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: 'lead-1' },
    });
    expect(outcome.kind).toBe('visit_failed');
    expect((outcome as { note: string }).note).toMatch(/get_available_slots/);
    expect(finishHandoffCode).toHaveBeenCalledWith('code-1', expect.objectContaining({ status: 'failed', result: 'slot_taken' }));
  });

  it('a "continue" code links the lead to the WhatsApp session and returns "linked"', async () => {
    claimHandoffCode.mockResolvedValue(CONTINUE_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(setSessionLead).toHaveBeenCalledWith(WA_SESSION_ID, 'lead-1');
    expect(bookVisit).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'linked', note: expect.stringContaining('chat web') });
  });

  it('never links a lead when the WhatsApp session already has one', async () => {
    claimHandoffCode.mockResolvedValue(CONTINUE_CODE);
    await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: 'existing-lead' },
    });
    expect(setSessionLead).not.toHaveBeenCalled();
  });

  it('overwrites an unverified stored phone with the redeemer\'s and flips phoneVerified=true', async () => {
    selectLimit.mockResolvedValue([{ phone: '+51900000000', sourceMeta: { phoneVerified: false } }]);
    claimHandoffCode.mockResolvedValue(CONTINUE_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ phone: PHONE }));
    expect(outcome).toEqual({ kind: 'linked', note: expect.stringContaining('chat web') });
  });

  it('does not overwrite a verified phone that differs from the redeemer\'s and records a note', async () => {
    selectLimit.mockResolvedValue([{ phone: '+51900000000', sourceMeta: { phoneVerified: true } }]);
    claimHandoffCode.mockResolvedValue(CONTINUE_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(updateSet).not.toHaveBeenCalled();
    expect((outcome as { note: string }).note).toMatch(/no se sobrescribió/);
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'web_handoff_redeemed',
      data: expect.objectContaining({ phoneConflictNote: expect.stringContaining('+51900000000') }),
    }));
  });

  it('leaves an already-verified matching phone untouched (no conflict, no overwrite call)', async () => {
    selectLimit.mockResolvedValue([{ phone: PHONE, sourceMeta: { phoneVerified: true } }]);
    claimHandoffCode.mockResolvedValue(CONTINUE_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Código WEB-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome).toEqual({ kind: 'linked', note: expect.stringContaining('chat web') });
    expect((outcome as { note: string }).note).not.toMatch(/no se sobrescribió/);
  });

  it('a voice code claimed from a different phone than target_phone → "none" (claimHandoffCode enforces it, mocked as a miss)', async () => {
    claimHandoffCode.mockResolvedValue(null);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: '+51900000001', text: 'Confirmo VOZ-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome).toEqual({ kind: 'none' });
    expect(claimHandoffCode).toHaveBeenCalledWith(ORG_ID, 'VOZ-ABCDEF', '+51900000001', WA_SESSION_ID);
  });

  it('the bare "Confirmar visita" quick-reply text resolves to the phone\'s latest pending voice code', async () => {
    getLatestPendingVoiceCodeForPhone.mockResolvedValue(VOICE_VISIT_CODE);
    claimHandoffCode.mockResolvedValue(VOICE_VISIT_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Confirmar visita',
      whatsappSession: { id: WA_SESSION_ID, leadId: 'lead-1' },
    });
    expect(getLatestPendingVoiceCodeForPhone).toHaveBeenCalledWith(ORG_ID, PHONE);
    expect(claimHandoffCode).toHaveBeenCalledWith(ORG_ID, 'VOZ-ABCDEF', PHONE, WA_SESSION_ID);
    expect(outcome.kind).toBe('visit_booked');
  });

  it('unrelated text with no code and no voice quick-reply never calls getLatestPendingVoiceCodeForPhone', async () => {
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'hola, buenas tardes',
      whatsappSession: { id: WA_SESSION_ID, leadId: null },
    });
    expect(outcome).toEqual({ kind: 'none' });
    expect(getLatestPendingVoiceCodeForPhone).not.toHaveBeenCalled();
    expect(claimHandoffCode).not.toHaveBeenCalled();
  });

  it('a voice code books the visit with sourceChannel "voice"', async () => {
    claimHandoffCode.mockResolvedValue(VOICE_VISIT_CODE);
    const outcome = await redeemWebHandoffCode({
      orgId: ORG_ID, phoneE164: PHONE, text: 'Confirmo VOZ-ABCDEF',
      whatsappSession: { id: WA_SESSION_ID, leadId: 'lead-1' },
    });
    expect(bookVisit).toHaveBeenCalledWith(expect.objectContaining({ sourceChannel: 'voice', contactPhone: PHONE }));
    expect(outcome).toEqual(expect.objectContaining({ kind: 'visit_booked', visitId: 'visit-1' }));
  });
});
