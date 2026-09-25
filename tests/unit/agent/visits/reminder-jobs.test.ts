import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  claimVisitFlagMock,
  releaseVisitFlagMock,
  getVisitMock,
  getOrCreateAgentConfigMock,
  getOrCreateSessionMock,
  getAvailableSlotsForOrgMock,
  sendMessageMock,
  sendInteractiveButtonsMock,
  sendInteractiveListMock,
  sendTemplateMock,
  upsertConversationMock,
  insertMessageMock,
  updateConversationActivityMock,
  selectQueue,
  insertedRows,
} = vi.hoisted(() => ({
  claimVisitFlagMock: vi.fn(),
  releaseVisitFlagMock: vi.fn(async () => {}),
  getVisitMock: vi.fn(),
  getOrCreateAgentConfigMock: vi.fn(async () => ({ timezone: 'America/Lima' })),
  getOrCreateSessionMock: vi.fn(async () => ({ id: 'session-1' })),
  getAvailableSlotsForOrgMock: vi.fn(async () => ({ timezone: 'America/Lima', slots: [], loadByProfile: {} })),
  sendMessageMock: vi.fn(async () => ({ success: true, providerMessageId: 'mock-1' })),
  sendInteractiveButtonsMock: vi.fn(async () => ({ success: true, providerMessageId: 'mock-2' })),
  sendInteractiveListMock: vi.fn(async () => ({ success: true, providerMessageId: 'mock-3' })),
  sendTemplateMock: vi.fn(async () => ({ success: true, providerMessageId: 'mock-4' })),
  upsertConversationMock: vi.fn(async () => 'conv-1'),
  insertMessageMock: vi.fn(async () => 'msg-1'),
  updateConversationActivityMock: vi.fn(async () => {}),
  selectQueue: [] as unknown[][],
  insertedRows: [] as unknown[],
}));

function pushSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => selectQueue.shift() ?? []),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: unknown) => {
        insertedRows.push(v);
        return [];
      }),
    })),
  },
}));

vi.mock('@/lib/agent/visits/service', () => ({
  claimVisitFlag: claimVisitFlagMock,
  releaseVisitFlag: releaseVisitFlagMock,
  getVisit: getVisitMock,
}));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: getOrCreateAgentConfigMock,
}));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession: getOrCreateSessionMock,
  isWindowOpen: (session: { windowExpiresAt?: Date | null }, now: Date = new Date()) =>
    !!session.windowExpiresAt && session.windowExpiresAt.getTime() > now.getTime(),
}));

vi.mock('@/lib/agent/visits/availability', () => ({
  getAvailableSlotsForOrg: getAvailableSlotsForOrgMock,
}));

vi.mock('@/lib/whatsapp', () => ({
  getWhatsAppProvider: () => ({
    sendMessage: sendMessageMock,
    sendInteractiveButtons: sendInteractiveButtonsMock,
    sendInteractiveList: sendInteractiveListMock,
    sendTemplate: sendTemplateMock,
  }),
}));

vi.mock('@/lib/whatsapp/db', () => ({
  upsertConversation: upsertConversationMock,
  insertMessage: insertMessageMock,
  updateConversationActivity: updateConversationActivityMock,
}));

import {
  handleVisitReminder24h,
  handleVisitReminder2h,
  handleVisitAdvisorReminder,
  handleVisitPostCheck,
} from '@/lib/agent/visits/reminder-jobs';

function visit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'visit-1',
    orgId: 'org-1',
    leadId: 'lead-1',
    listingId: '44444444-4444-4444-4444-444444444444',
    profileId: '33333333-3333-3333-3333-333333333333',
    sessionId: null,
    contactPhone: '+51999888777',
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

describe('agent/visits/reminder-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    insertedRows.length = 0;
    getOrCreateAgentConfigMock.mockResolvedValue({ timezone: 'America/Lima' });
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1' });
    getAvailableSlotsForOrgMock.mockResolvedValue({ timezone: 'America/Lima', slots: [], loadByProfile: {} });
    // vi.clearAllMocks() clears call history but not a persisted
    // mockResolvedValue from a prior test — reset the send-result defaults
    // explicitly so every test starts from "provider send succeeds".
    sendMessageMock.mockResolvedValue({ success: true, providerMessageId: 'mock-1' });
    sendInteractiveButtonsMock.mockResolvedValue({ success: true, providerMessageId: 'mock-2' });
    sendInteractiveListMock.mockResolvedValue({ success: true, providerMessageId: 'mock-3' });
    sendTemplateMock.mockResolvedValue({ success: true, providerMessageId: 'mock-4' });
  });

  const payload = { visitId: 'visit-1', startsAt: '2026-06-10T15:00:00.000Z' };

  it('reminder_24h: no-op on a stale startsAt guard (claimVisitFlag returns null)', async () => {
    claimVisitFlagMock.mockResolvedValue(null);
    await handleVisitReminder24h(payload, 'org-1');
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(sendInteractiveButtonsMock).not.toHaveBeenCalled();
  });

  it('reminder_24h: no-op when the visit was cancelled (claimVisitFlag returns null)', async () => {
    claimVisitFlagMock.mockResolvedValue(null);
    await handleVisitReminder24h(payload, 'org-1');
    expect(getVisitMock).not.toHaveBeenCalled();
  });

  it('reminder_24h: no-op when the flag was already claimed by another worker', async () => {
    claimVisitFlagMock.mockResolvedValue(null);
    await handleVisitReminder24h(payload, 'org-1');
    expect(releaseVisitFlagMock).not.toHaveBeenCalled();
  });

  it('reminder_24h: skips the send entirely when the lead has do_not_contact', async () => {
    claimVisitFlagMock.mockResolvedValue(visit({ leadId: 'lead-dnc' }));
    pushSelect([{ doNotContact: true }]); // crm_leads.do_not_contact lookup
    await handleVisitReminder24h(payload, 'org-1');
    expect(getVisitMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('reminder_24h: open window uses interactive buttons', async () => {
    claimVisitFlagMock.mockResolvedValue(visit());
    pushSelect([{ doNotContact: false }]);
    getVisitMock.mockResolvedValue(visit());
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });

    await handleVisitReminder24h(payload, 'org-1');

    expect(sendInteractiveButtonsMock).toHaveBeenCalledOnce();
    expect(sendTemplateMock).not.toHaveBeenCalled();
    const opts = sendInteractiveButtonsMock.mock.calls[0][1];
    expect(opts.buttons.map((b: { id: string }) => b.id)).toEqual(['visit:visit-1:confirm', 'visit:visit-1:resched']);
  });

  it('reminder_24h: closed window uses the template', async () => {
    claimVisitFlagMock.mockResolvedValue(visit());
    pushSelect([{ doNotContact: false }]);
    getVisitMock.mockResolvedValue(visit());
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: null });

    await handleVisitReminder24h(payload, 'org-1');

    expect(sendInteractiveButtonsMock).not.toHaveBeenCalled();
    expect(sendTemplateMock).toHaveBeenCalledOnce();
    expect(sendTemplateMock.mock.calls[0][1].templateName).toBe('recordatorio_visita_24h');
  });

  it('reminder_2h: a failed send releases the flag and throws (so jobs.ts retries)', async () => {
    claimVisitFlagMock.mockResolvedValue(visit());
    pushSelect([{ doNotContact: false }]);
    getVisitMock.mockResolvedValue(visit());
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });
    sendInteractiveButtonsMock.mockResolvedValue({ success: false, error: 'boom' });

    await expect(handleVisitReminder2h(payload, 'org-1')).rejects.toThrow();
    expect(releaseVisitFlagMock).toHaveBeenCalledWith('org-1', 'visit-1', 'reminder_2h_sent_at');
  });

  it('advisor_reminder: creates a notification and best-effort WhatsApp; a failed send does not throw', async () => {
    claimVisitFlagMock.mockResolvedValue(visit());
    getVisitMock.mockResolvedValue(visit());
    pushSelect([{ phone: '51999111222' }]); // profiles.phone lookup
    sendMessageMock.mockResolvedValue({ success: false, error: 'boom' });
    // Open window + no buttons on the advisor message -> messaging.ts's plain-text path (provider.sendMessage).
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });

    await expect(handleVisitAdvisorReminder(payload, 'org-1')).resolves.toBeUndefined();

    expect(insertedRows.some((r) => (r as { type?: string }).type === 'visit_reminder')).toBe(true);
  });

  it('post_check: completed status sends feedback buttons', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'completed' }));
    pushSelect([{ doNotContact: false }]);
    claimVisitFlagMock.mockResolvedValue(visit({ status: 'completed' }));
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });

    await handleVisitPostCheck(payload, 'org-1');

    expect(claimVisitFlagMock).toHaveBeenCalledWith('org-1', 'visit-1', 'feedback_requested_at', expect.objectContaining({
      statuses: ['scheduled', 'confirmed', 'completed', 'no_show'],
    }));
    expect(sendInteractiveButtonsMock).toHaveBeenCalledOnce();
    const opts = sendInteractiveButtonsMock.mock.calls[0][1];
    expect(opts.buttons.map((b: { id: string }) => b.id)).toEqual(['visit:visit-1:fb_yes', 'visit:visit-1:fb_no', 'visit:visit-1:fb_more']);
  });

  it('post_check: no_show status sends a reoffer list', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'no_show' }));
    pushSelect([{ doNotContact: false }]);
    claimVisitFlagMock.mockResolvedValue(visit({ status: 'no_show' }));
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });
    getAvailableSlotsForOrgMock.mockResolvedValue({
      timezone: 'America/Lima',
      slots: [{ profileId: '33333333-3333-3333-3333-333333333333', startsAt: new Date('2026-06-12T15:00:00Z'), endsAt: new Date('2026-06-12T15:45:00Z'), bufferMinutes: 15 }],
      loadByProfile: { '33333333-3333-3333-3333-333333333333': 0 },
    });

    await handleVisitPostCheck(payload, 'org-1');

    expect(claimVisitFlagMock).toHaveBeenCalledWith('org-1', 'visit-1', 'reoffer_sent_at', expect.objectContaining({
      statuses: ['scheduled', 'confirmed', 'completed', 'no_show'],
    }));
    expect(sendInteractiveListMock).toHaveBeenCalledOnce();
    const opts = sendInteractiveListMock.mock.calls[0][1];
    expect(opts.rows.some((r: { id: string }) => r.id === 'visit:visit-1:cancel')).toBe(true);
    expect(opts.rows.some((r: { id: string }) => r.id.startsWith('vslot:visit-1:'))).toBe(true);
  });

  it('post_check: active/unmarked status sends "went / missed" buttons', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'scheduled' }));
    pushSelect([{ doNotContact: false }]);
    claimVisitFlagMock.mockResolvedValue(visit({ status: 'scheduled' }));
    getOrCreateSessionMock.mockResolvedValue({ id: 'session-1', windowExpiresAt: new Date(Date.now() + 60_000) });

    await handleVisitPostCheck(payload, 'org-1');

    expect(claimVisitFlagMock).toHaveBeenCalledWith('org-1', 'visit-1', 'post_check_sent_at', expect.objectContaining({
      statuses: ['scheduled', 'confirmed', 'completed', 'no_show'],
    }));
    const opts = sendInteractiveButtonsMock.mock.calls[0][1];
    expect(opts.buttons.map((b: { id: string }) => b.id)).toEqual(['visit:visit-1:went', 'visit:visit-1:missed']);
  });

  it('post_check: do_not_contact skips the send entirely', async () => {
    getVisitMock.mockResolvedValue(visit({ status: 'completed' }));
    pushSelect([{ doNotContact: true }]);

    await handleVisitPostCheck(payload, 'org-1');

    expect(claimVisitFlagMock).not.toHaveBeenCalled();
    expect(sendInteractiveButtonsMock).not.toHaveBeenCalled();
  });

  it('post_check: a drifted startsAt (rescheduled visit) is a no-op', async () => {
    getVisitMock.mockResolvedValue(visit({ startsAt: new Date('2026-06-11T15:00:00Z') }));
    await handleVisitPostCheck(payload, 'org-1');
    expect(claimVisitFlagMock).not.toHaveBeenCalled();
  });
});
