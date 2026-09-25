import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getVisitMock,
  findNextActiveVisitByPhoneMock,
  confirmVisitMock,
  cancelVisitMock,
  markVisitOutcomeMock,
  recordVisitFeedbackMock,
  rescheduleVisitMock,
  claimVisitFlagMock,
  buildReofferListMock,
  sendFeedbackRequestMock,
  sendReofferMock,
  sendVisitMessageMock,
  getOrCreateAgentConfigMock,
  getOrCreateSessionMock,
  isSlotStillAvailableMock,
  insertMessageMock,
  queueAgentInboundMock,
  dbInsertValues,
} = vi.hoisted(() => ({
  getVisitMock: vi.fn(),
  findNextActiveVisitByPhoneMock: vi.fn(),
  confirmVisitMock: vi.fn(),
  cancelVisitMock: vi.fn(),
  markVisitOutcomeMock: vi.fn(),
  recordVisitFeedbackMock: vi.fn(),
  rescheduleVisitMock: vi.fn(),
  claimVisitFlagMock: vi.fn(async () => ({ id: 'visit-1' })),
  buildReofferListMock: vi.fn(async () => null),
  sendFeedbackRequestMock: vi.fn(async () => true),
  sendReofferMock: vi.fn(async () => true),
  sendVisitMessageMock: vi.fn(async () => ({ success: true, providerMessageId: 'mock-1' })),
  getOrCreateAgentConfigMock: vi.fn(async () => ({ timezone: 'America/Lima' })),
  getOrCreateSessionMock: vi.fn(async () => ({ id: 'session-1' })),
  isSlotStillAvailableMock: vi.fn(async () => true),
  insertMessageMock: vi.fn(async () => 'msg-1'),
  queueAgentInboundMock: vi.fn(async () => true),
  dbInsertValues: vi.fn(async () => []),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: dbInsertValues })),
  },
}));

vi.mock('@/lib/agent/visits/service', () => ({
  getVisit: getVisitMock,
  findNextActiveVisitByPhone: findNextActiveVisitByPhoneMock,
  confirmVisit: confirmVisitMock,
  cancelVisit: cancelVisitMock,
  markVisitOutcome: markVisitOutcomeMock,
  recordVisitFeedback: recordVisitFeedbackMock,
  rescheduleVisit: rescheduleVisitMock,
  claimVisitFlag: claimVisitFlagMock,
}));

vi.mock('@/lib/agent/visits/reminder-jobs', () => ({
  buildReofferList: buildReofferListMock,
  sendFeedbackRequest: sendFeedbackRequestMock,
  sendReoffer: sendReofferMock,
  sanitizeText: (s: string, maxLen = 60) => s.replace(/\s+/g, ' ').trim().slice(0, maxLen),
}));

vi.mock('@/lib/agent/visits/availability', () => ({
  isSlotStillAvailable: isSlotStillAvailableMock,
}));

vi.mock('@/lib/agent/visits/messaging', () => ({
  sendVisitMessage: sendVisitMessageMock,
}));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: getOrCreateAgentConfigMock,
}));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession: getOrCreateSessionMock,
}));

vi.mock('@/lib/whatsapp/db', () => ({
  insertMessage: insertMessageMock,
}));

vi.mock('@/lib/agent/whatsapp-dispatch', () => ({
  queueAgentInbound: queueAgentInboundMock,
}));

import { encodeSlotId } from '@/lib/agent/visits/slot-id';
import { handleVisitButtonReply, isVisitButtonReply } from '@/lib/agent/visits/button-reply';

const ORG = 'org-1';
const PHONE = '+51999888777';
const OTHER_PHONE = '+51999000111';

function visit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'visit-1',
    orgId: ORG,
    leadId: 'lead-1',
    listingId: '44444444-4444-4444-4444-444444444444',
    profileId: '33333333-3333-3333-3333-333333333333',
    sessionId: null,
    contactPhone: PHONE,
    startsAt: new Date('2026-06-10T15:00:00Z'),
    endsAt: new Date('2026-06-10T15:45:00Z'),
    blockedUntil: new Date('2026-06-10T16:00:00Z'),
    status: 'scheduled',
    createdBy: 'agent',
    sourceChannel: 'whatsapp',
    rescheduledFromId: null,
    feedback: null,
    notes: null,
    listingTitle: 'Depa en Miraflores',
    advisorName: 'Ana Asesora',
    leadName: 'Juan Lead',
    ...overrides,
  };
}

describe('agent/visits/button-reply isVisitButtonReply + grammar', () => {
  it('matches visit: and vslot: prefixed ids', () => {
    expect(isVisitButtonReply('visit:visit-1:confirm')).toBe(true);
    expect(isVisitButtonReply('vslot:visit-1:sl_abc')).toBe(true);
  });

  it('matches known template quick-reply texts, case/accent-insensitively', () => {
    expect(isVisitButtonReply('Confirmo')).toBe(true);
    expect(isVisitButtonReply('reprogramar')).toBe(true);
    expect(isVisitButtonReply('Sí, fui')).toBe(true);
    expect(isVisitButtonReply('si, FUI')).toBe(true);
    expect(isVisitButtonReply('No pude ir')).toBe(true);
  });

  it('does not match unrelated ids/text', () => {
    expect(isVisitButtonReply('task:1:done')).toBe(false);
    expect(isVisitButtonReply('hola')).toBe(false);
  });
});

describe('agent/visits/button-reply handleVisitButtonReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateAgentConfigMock.mockResolvedValue({ timezone: 'America/Lima' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    sendVisitMessageMock.mockResolvedValue({ success: true, providerMessageId: 'mock-1' });
    buildReofferListMock.mockResolvedValue(null);
    claimVisitFlagMock.mockResolvedValue({ id: 'visit-1' });
    isSlotStillAvailableMock.mockResolvedValue(true);
  });

  it('returns handled:false for an id that is not visit grammar or a known template text', async () => {
    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'unrelated', replyTitle: null, whatsappConversationId: 'conv-1' });
    expect(result).toEqual({ handled: false });
    expect(getVisitMock).not.toHaveBeenCalled();
  });

  it('a phone mismatch on a visit: id responds not_found without acting', async () => {
    getVisitMock.mockResolvedValue(visit({ contactPhone: OTHER_PHONE }));
    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:confirm', replyTitle: null, whatsappConversationId: 'conv-1' });
    expect(result).toEqual({ handled: true, action: 'not_found' });
    expect(confirmVisitMock).not.toHaveBeenCalled();
  });

  it('resolves a template quick-reply text via findNextActiveVisitByPhone', async () => {
    findNextActiveVisitByPhoneMock.mockResolvedValue(visit());
    confirmVisitMock.mockResolvedValue(visit({ status: 'confirmed' }));

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'Confirmo', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(findNextActiveVisitByPhoneMock).toHaveBeenCalledWith(ORG, PHONE, 24);
    expect(confirmVisitMock).toHaveBeenCalledWith(ORG, 'visit-1');
    expect(result).toEqual({ handled: true, action: 'confirmed' });
  });

  it('a template text with no matching visit responds not_found', async () => {
    findNextActiveVisitByPhoneMock.mockResolvedValue(null);
    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'Reprogramar', replyTitle: null, whatsappConversationId: 'conv-1' });
    expect(result).toEqual({ handled: true, action: 'not_found' });
  });

  it('vslot with slot_taken re-sends a fresh list', async () => {
    getVisitMock.mockResolvedValue(visit());
    const slotId = encodeSlotId(
      { profileId: '33333333-3333-3333-3333-333333333333', listingId: '44444444-4444-4444-4444-444444444444', startsAt: new Date('2026-06-12T15:00:00Z'), visitMinutes: 45 },
      { orgId: ORG, sessionId: 'session-1' },
    );
    rescheduleVisitMock.mockResolvedValue({ ok: false, reason: 'slot_taken' });
    buildReofferListMock.mockResolvedValue({ buttonText: 'Ver horarios', rows: [{ id: 'vslot:visit-1:sl_new', title: 'jue 12 jun, 10:00' }] });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: `vslot:visit-1:${slotId}`, replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'slot_taken' });
    expect(sendVisitMessageMock).toHaveBeenCalledOnce();
    expect(sendVisitMessageMock.mock.calls[0][0].list).toBeTruthy();
  });

  it('vslot success reschedules and confirms', async () => {
    getVisitMock.mockResolvedValue(visit());
    const slotId = encodeSlotId(
      { profileId: '33333333-3333-3333-3333-333333333333', listingId: '44444444-4444-4444-4444-444444444444', startsAt: new Date('2026-06-12T15:00:00Z'), visitMinutes: 45 },
      { orgId: ORG, sessionId: 'session-1' },
    );
    rescheduleVisitMock.mockResolvedValue({ ok: true, visit: visit({ id: 'visit-2', startsAt: new Date('2026-06-12T15:00:00Z') }) });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: `vslot:visit-1:${slotId}`, replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'rescheduled' });
  });

  it('vslot rejects a stale claim (isSlotStillAvailable false) without calling rescheduleVisit', async () => {
    getVisitMock.mockResolvedValue(visit());
    isSlotStillAvailableMock.mockResolvedValueOnce(false);
    const slotId = encodeSlotId(
      { profileId: '33333333-3333-3333-3333-333333333333', listingId: '44444444-4444-4444-4444-444444444444', startsAt: new Date('2026-06-12T15:00:00Z'), visitMinutes: 45 },
      { orgId: ORG, sessionId: 'session-1' },
    );
    buildReofferListMock.mockResolvedValue({ buttonText: 'Ver horarios', rows: [{ id: 'vslot:visit-1:sl_new', title: 'jue 12 jun, 10:00' }] });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: `vslot:visit-1:${slotId}`, replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'slot_taken' });
    expect(rescheduleVisitMock).not.toHaveBeenCalled();
    expect(buildReofferListMock).toHaveBeenCalledWith(ORG, expect.objectContaining({ id: 'visit-1' }), 'keep');
  });

  it('resched offers a "keep" decline row, not "cancel"', async () => {
    getVisitMock.mockResolvedValue(visit());
    buildReofferListMock.mockResolvedValue({ buttonText: 'Ver horarios', rows: [{ id: 'visit:visit-1:keep', title: 'No, gracias' }] });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:resched', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(buildReofferListMock).toHaveBeenCalledWith(ORG, expect.objectContaining({ id: 'visit-1' }), 'keep');
    expect(result).toEqual({ handled: true, action: 'reschedule_offered' });
  });

  it('keep acks that the visit was kept, without cancelling or rescheduling it', async () => {
    getVisitMock.mockResolvedValue(visit());

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:keep', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'kept' });
    expect(cancelVisitMock).not.toHaveBeenCalled();
    expect(rescheduleVisitMock).not.toHaveBeenCalled();
    expect(sendVisitMessageMock).toHaveBeenCalledWith(expect.objectContaining({ bodyText: expect.stringMatching(/mantenemos/i) }));
  });

  it('fb_more records feedback and returns an agentFollowupText', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'completed' }));
    recordVisitFeedbackMock.mockResolvedValue(visit({ status: 'completed', feedback: 'wants_more' }));

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:fb_more', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(recordVisitFeedbackMock).toHaveBeenCalledWith(ORG, 'visit-1', 'wants_more');
    expect(result).toEqual({ handled: true, action: 'feedback_recorded', agentFollowupText: 'Quiero ver otras opciones' });
  });

  it('fb_yes records feedback and notifies the advisor', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'completed' }));
    recordVisitFeedbackMock.mockResolvedValue(visit({ status: 'completed', feedback: 'interested' }));

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:fb_yes', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'feedback_recorded' });
    expect(dbInsertValues).toHaveBeenCalledWith(expect.objectContaining({ type: 'visit_feedback' }));
  });

  it('went marks the visit completed and requests feedback', async () => {
    getVisitMock.mockResolvedValue(visit());
    markVisitOutcomeMock.mockResolvedValue(visit({ status: 'completed' }));

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:went', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(markVisitOutcomeMock).toHaveBeenCalledWith({ orgId: ORG, visitId: 'visit-1', outcome: 'completed', source: 'lead' });
    expect(sendFeedbackRequestMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ handled: true, action: 'outcome_recorded' });
  });

  it('missed marks the visit no_show and sends a reoffer', async () => {
    getVisitMock.mockResolvedValue(visit());
    markVisitOutcomeMock.mockResolvedValue(visit({ status: 'no_show' }));

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:missed', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(markVisitOutcomeMock).toHaveBeenCalledWith({ orgId: ORG, visitId: 'visit-1', outcome: 'no_show', source: 'lead' });
    expect(claimVisitFlagMock).toHaveBeenCalledWith(ORG, 'visit-1', 'reoffer_sent_at', {});
    expect(sendReofferMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ handled: true, action: 'outcome_recorded' });
  });

  it('went does not resend feedback when claimVisitFlag reports it was already claimed (replay-safe)', async () => {
    getVisitMock.mockResolvedValue(visit());
    markVisitOutcomeMock.mockResolvedValue(visit({ status: 'completed' }));
    claimVisitFlagMock.mockResolvedValueOnce(null);

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:went', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(sendFeedbackRequestMock).not.toHaveBeenCalled();
    expect(result).toEqual({ handled: true, action: 'outcome_recorded' });
  });

  it('missed does not resend a reoffer when claimVisitFlag reports it was already claimed (replay-safe)', async () => {
    getVisitMock.mockResolvedValue(visit());
    markVisitOutcomeMock.mockResolvedValue(visit({ status: 'no_show' }));
    claimVisitFlagMock.mockResolvedValueOnce(null);

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:missed', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(sendReofferMock).not.toHaveBeenCalled();
    expect(result).toEqual({ handled: true, action: 'outcome_recorded' });
  });

  it('cancel cancels the visit', async () => {
    getVisitMock.mockResolvedValue(visit());
    cancelVisitMock.mockResolvedValue({ ok: true });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:cancel', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(cancelVisitMock).toHaveBeenCalledWith({ orgId: ORG, visitId: 'visit-1', leadId: 'lead-1', actor: 'lead_button' });
    expect(result).toEqual({ handled: true, action: 'cancelled' });
  });

  it('cancel still acks when the visit is already not_active (e.g. a replayed webhook)', async () => {
    getVisitMock.mockResolvedValue(visit());
    cancelVisitMock.mockResolvedValue({ ok: false, reason: 'not_active' });

    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:cancel', replyTitle: null, whatsappConversationId: 'conv-1' });

    expect(result).toEqual({ handled: true, action: 'cancelled' });
    expect(sendVisitMessageMock).toHaveBeenCalledOnce();
  });

  it('never throws — an unexpected error resolves to handled:false so the agent turn still answers', async () => {
    getVisitMock.mockRejectedValue(new Error('db down'));
    const result = await handleVisitButtonReply({ orgId: ORG, fromPhone: PHONE, replyId: 'visit:visit-1:confirm', replyTitle: null, whatsappConversationId: 'conv-1' });
    expect(result).toEqual({ handled: false });
  });
});
