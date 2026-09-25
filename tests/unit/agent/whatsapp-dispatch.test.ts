import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above regular declarations, so any mock fns
// they close over must be created via vi.hoisted() to avoid a TDZ error.
const {
  callOrder,
  getSessionByConversation,
  getSessionById,
  tryAcquireSessionLock,
  releaseSessionLock,
  setAssistantMessageSendStatus,
  claimPendingInbound,
  finishClaimedInbound,
  hasPendingInbound,
  listStalePendingConversations,
  listHumanRepliesSince,
  getOrCreateAgentConfig,
  getLead,
  runAgentTurn,
  createSuggestion,
  sendWhatsAppText,
  recordAgentEvent,
  enqueueJob,
  stopFollowups,
  scheduleFollowupSequence,
  getOrCreateSession,
  redeemWebHandoffCode,
} = vi.hoisted(() => ({
  callOrder: [] as string[],
  getSessionByConversation: vi.fn(),
  getSessionById: vi.fn(),
  tryAcquireSessionLock: vi.fn(async () => true),
  releaseSessionLock: vi.fn(async () => {}),
  setAssistantMessageSendStatus: vi.fn(async () => {}),
  claimPendingInbound: vi.fn(async () => [] as Array<{ id: string; body: string | null; attachmentKind: string | null; createdAt: Date }>),
  finishClaimedInbound: vi.fn(async () => {}),
  hasPendingInbound: vi.fn(async () => false),
  listStalePendingConversations: vi.fn(async () => [] as Array<{ orgId: string; conversationId: string }>),
  listHumanRepliesSince: vi.fn(async () => [] as string[]),
  getOrCreateAgentConfig: vi.fn(async () => ({ channelsEnabled: { whatsapp: true, web: false, voice: false }, shadowMode: false })),
  getLead: vi.fn(async () => null as { doNotContact: boolean } | null),
  runAgentTurn: vi.fn(async () => ({
    sessionId: 'session-1',
    leadId: null,
    replyText: 'hola!',
    handedOffToHuman: false,
    handoffReason: null,
    skipped: false,
    language: null,
    assistantMessageId: 'msg-assistant-1',
  })),
  createSuggestion: vi.fn(async () => 'suggestion-1'),
  sendWhatsAppText: vi.fn(async () => ({ ok: true, messageId: 'sent-1' })),
  recordAgentEvent: vi.fn(async () => {}),
  enqueueJob: vi.fn(async () => 'job-1'),
  stopFollowups: vi.fn(async () => 0),
  scheduleFollowupSequence: vi.fn(async () => 0),
  getOrCreateSession: vi.fn(),
  redeemWebHandoffCode: vi.fn(async () => ({ kind: 'none' }) as unknown),
}));

const SESSION = {
  id: 'session-1',
  orgId: 'org-1',
  channel: 'whatsapp' as const,
  externalId: '+51999999999',
  leadId: null as string | null,
  whatsappConversationId: 'conv-1',
  mode: 'ai' as const,
  summary: null,
  agentTurnCount: 0,
  language: null,
  attribution: null,
  handoffReason: null,
  windowExpiresAt: new Date(Date.now() + 60_000),
  lastAgentTurnAt: null,
};

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(async () => []),
      limit: vi.fn(async () => []),
    })),
  },
}));

vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession,
  getSessionByConversation,
  getSessionById,
  touchInbound: vi.fn(async () => {}),
  tryAcquireSessionLock: (...args: unknown[]) => {
    callOrder.push('tryAcquireSessionLock');
    return tryAcquireSessionLock(...args);
  },
  releaseSessionLock: (...args: unknown[]) => {
    callOrder.push('releaseSessionLock');
    return releaseSessionLock(...args);
  },
  setSessionAttributionIfEmpty: vi.fn(async () => false),
  setAssistantMessageSendStatus,
}));

vi.mock('@/lib/agent/lead', () => ({ getLead }));

vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));

vi.mock('@/lib/agent/jobs', () => ({ enqueueJob }));

vi.mock('@/lib/leads/followups', () => ({ stopFollowups, scheduleFollowupSequence }));

vi.mock('@/lib/agent/run-turn', () => ({ runAgentTurn }));

vi.mock('@/lib/agent/suggestions', () => ({ createSuggestion }));

vi.mock('@/lib/agent/outbound', () => ({ sendWhatsAppText }));

vi.mock('@/lib/agent/web-handoff-redeem', () => ({ redeemWebHandoffCode }));

vi.mock('@/lib/whatsapp/referral', () => ({
  parseCtwaReferral: vi.fn(() => null),
  extractRefCode: vi.fn(() => null),
}));

vi.mock('@/lib/whatsapp/db', () => ({
  claimPendingInbound: (...args: unknown[]) => {
    callOrder.push('claimPendingInbound');
    return claimPendingInbound(...args);
  },
  finishClaimedInbound,
  hasPendingInbound: (...args: unknown[]) => {
    callOrder.push('hasPendingInbound');
    return hasPendingInbound(...args);
  },
  listStalePendingConversations,
  listHumanRepliesSince,
}));

import { processWhatsAppAgentTurn, queueAgentInbound, sweepStalePendingInbound } from '@/lib/agent/whatsapp-dispatch';

const CLAIMED = [
  { id: 'm1', body: 'Hola', attachmentKind: null, createdAt: new Date('2026-01-01T00:00:00Z') },
  { id: 'm2', body: null, attachmentKind: 'image', createdAt: new Date('2026-01-01T00:00:05Z') },
];

describe('agent/whatsapp-dispatch — processWhatsAppAgentTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    getSessionByConversation.mockResolvedValue({ ...SESSION });
    getSessionById.mockResolvedValue({ ...SESSION });
    tryAcquireSessionLock.mockResolvedValue(true);
    claimPendingInbound.mockResolvedValue(CLAIMED);
    hasPendingInbound.mockResolvedValue(false);
    listStalePendingConversations.mockResolvedValue([]);
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false }, shadowMode: false });
    getLead.mockResolvedValue(null);
    stopFollowups.mockResolvedValue(0);
    scheduleFollowupSequence.mockResolvedValue(1);
    redeemWebHandoffCode.mockResolvedValue({ kind: 'none' });
  });

  it('no-ops when the session lock is busy', async () => {
    tryAcquireSessionLock.mockResolvedValue(false);
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(claimPendingInbound).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('joins claimed messages into inboundText, using an attachment placeholder for a bodyless attachment', async () => {
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ inboundText: 'Hola\n[imagen]' }));
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'processed');
  });

  it('shadow mode creates a suggestion and never sends', async () => {
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false }, shadowMode: true });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(createSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      conversationId: 'conv-1',
      body: 'hola!',
      agentMessageId: 'msg-assistant-1',
    }));
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('mode "human" means the claimed messages are skipped without running the model', async () => {
    getSessionByConversation.mockResolvedValue({ ...SESSION, mode: 'human' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'skipped');
  });

  it('do_not_contact means skipped without running the model', async () => {
    getSessionByConversation.mockResolvedValue({ ...SESSION, leadId: 'lead-1' });
    getLead.mockResolvedValue({ doNotContact: true });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'skipped');
  });

  it('reverts claimed messages to pending and rethrows on a turn error', async () => {
    runAgentTurn.mockRejectedValueOnce(new Error('model exploded'));
    await expect(
      processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1')
    ).rejects.toThrow('model exploded');
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'pending');
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'turn_error' }));
  });

  it('releases the session lock before re-checking for pending messages', async () => {
    hasPendingInbound.mockResolvedValue(true);
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    const releaseIdx = callOrder.indexOf('releaseSessionLock');
    const recheckIdx = callOrder.indexOf('hasPendingInbound');
    expect(releaseIdx).toBeGreaterThanOrEqual(0);
    expect(recheckIdx).toBeGreaterThan(releaseIdx);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent.whatsapp_turn' }));
  });

  it('runs the turn with the loaded session\'s externalId, not the (possibly stale/absent) job payload externalPhone', async () => {
    getSessionByConversation.mockResolvedValue({ ...SESSION, externalId: '+51888888888' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ externalId: '+51888888888' }));
  });

  it('re-enqueues the follow-up job without an externalPhone in the payload', async () => {
    hasPendingInbound.mockResolvedValue(true);
    await processWhatsAppAgentTurn({ conversationId: 'conv-1' }, 'org-1');
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'agent.whatsapp_turn',
      payload: { conversationId: 'conv-1' },
    }));
  });

  it('drops the reply and discards the draft when the session mode changed away from "ai" during the turn', async () => {
    getSessionById.mockResolvedValue({ ...SESSION, mode: 'human' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(createSuggestion).not.toHaveBeenCalled();
    expect(setAssistantMessageSendStatus).toHaveBeenCalledWith('msg-assistant-1', 'shadow_discarded');
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reply_dropped' }));
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'processed');
  });

  it('sends normally when the session mode is still "ai" after the turn', async () => {
    getSessionById.mockResolvedValue({ ...SESSION, mode: 'ai' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(sendWhatsAppText).toHaveBeenCalledOnce();
    expect(setAssistantMessageSendStatus).not.toHaveBeenCalled();
  });

  it('(re)anchors the follow-up sequence after a successful live send with a lead and no handoff', async () => {
    getSessionById.mockResolvedValue({ ...SESSION, mode: 'ai' });
    runAgentTurn.mockResolvedValue({
      sessionId: 'session-1', leadId: 'lead-1', replyText: 'hola!', handedOffToHuman: false,
      handoffReason: null, skipped: false, language: null, assistantMessageId: 'msg-assistant-1',
    });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(scheduleFollowupSequence).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', leadId: 'lead-1', sessionId: 'session-1' }));
  });

  it('does not schedule follow-ups when the turn handed off to a human', async () => {
    getSessionById.mockResolvedValue({ ...SESSION, mode: 'ai' });
    runAgentTurn.mockResolvedValue({
      sessionId: 'session-1', leadId: 'lead-1', replyText: 'hola!', handedOffToHuman: true,
      handoffReason: 'tool', skipped: false, language: null, assistantMessageId: 'msg-assistant-1',
    });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(scheduleFollowupSequence).not.toHaveBeenCalled();
  });

  it('does not schedule follow-ups in shadow mode', async () => {
    getOrCreateAgentConfig.mockResolvedValue({ channelsEnabled: { whatsapp: true, web: false, voice: false }, shadowMode: true });
    runAgentTurn.mockResolvedValue({
      sessionId: 'session-1', leadId: 'lead-1', replyText: 'hola!', handedOffToHuman: false,
      handoffReason: null, skipped: false, language: null, assistantMessageId: 'msg-assistant-1',
    });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(scheduleFollowupSequence).not.toHaveBeenCalled();
  });

  it('a visit_booked web handoff redemption sends the confirmation directly and never calls the model', async () => {
    redeemWebHandoffCode.mockResolvedValue({ kind: 'visit_booked', replyText: '¡Listo! Confirmamos tu visita.', visitId: 'visit-9' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(sendWhatsAppText).toHaveBeenCalledWith(expect.objectContaining({
      body: '¡Listo! Confirmamos tu visita.',
      senderKind: 'agent',
    }));
    expect(finishClaimedInbound).toHaveBeenCalledWith(['m1', 'm2'], 'processed');
  });

  it('a visit_booked redemption still releases the session lock (finally block)', async () => {
    redeemWebHandoffCode.mockResolvedValue({ kind: 'visit_booked', replyText: 'listo', visitId: 'visit-9' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(releaseSessionLock).toHaveBeenCalledWith('session-1');
  });

  it('a non-"none", non-"visit_booked" redemption outcome is forwarded as extraContextNotes to runAgentTurn', async () => {
    redeemWebHandoffCode.mockResolvedValue({ kind: 'linked', note: 'El usuario viene del chat web; su perfil ya está cargado.' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');

    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      extraContextNotes: ['El usuario viene del chat web; su perfil ya está cargado.'],
    }));
    expect(sendWhatsAppText).toHaveBeenCalledOnce(); // the normal AI reply still goes out
  });

  it('a "none" redemption outcome passes no extraContextNotes', async () => {
    redeemWebHandoffCode.mockResolvedValue({ kind: 'none' });
    await processWhatsAppAgentTurn({ conversationId: 'conv-1', externalPhone: '+51999999999' }, 'org-1');
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ extraContextNotes: undefined }));
  });
});

describe('agent/whatsapp-dispatch — queueAgentInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSession.mockResolvedValue({ ...SESSION });
    stopFollowups.mockResolvedValue(0);
  });

  it('stops any in-flight follow-up sequence for the session\'s lead on an inbound reply', async () => {
    getOrCreateSession.mockResolvedValue({ ...SESSION, leadId: 'lead-1' });
    await queueAgentInbound({ orgId: 'org-1', conversationId: 'conv-1', externalPhone: '+51999999999', text: 'hola', referral: null });
    expect(stopFollowups).toHaveBeenCalledWith('org-1', 'lead-1', 'replied');
  });

  it('does not call stopFollowups when the session has no lead yet', async () => {
    getOrCreateSession.mockResolvedValue({ ...SESSION, leadId: null });
    await queueAgentInbound({ orgId: 'org-1', conversationId: 'conv-1', externalPhone: '+51999999999', text: 'hola', referral: null });
    expect(stopFollowups).not.toHaveBeenCalled();
  });

  it('never breaks the inbound path when stopFollowups throws', async () => {
    getOrCreateSession.mockResolvedValue({ ...SESSION, leadId: 'lead-1' });
    stopFollowups.mockRejectedValueOnce(new Error('db down'));
    await expect(
      queueAgentInbound({ orgId: 'org-1', conversationId: 'conv-1', externalPhone: '+51999999999', text: 'hola', referral: null })
    ).resolves.toBe(true);
  });
});

describe('agent/whatsapp-dispatch — sweepStalePendingInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStalePendingConversations.mockResolvedValue([]);
  });

  it('enqueues a job with only conversationId — no externalPhone placeholder', async () => {
    listStalePendingConversations.mockResolvedValue([{ orgId: 'org-1', conversationId: 'conv-1' }]);
    const enqueued = await sweepStalePendingInbound();
    expect(enqueued).toBe(1);
    expect(enqueueJob).toHaveBeenCalledWith({
      orgId: 'org-1',
      kind: 'agent.whatsapp_turn',
      payload: { conversationId: 'conv-1' },
    });
  });

  it('no-ops when nothing is stale', async () => {
    const enqueued = await sweepStalePendingInbound();
    expect(enqueued).toBe(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
