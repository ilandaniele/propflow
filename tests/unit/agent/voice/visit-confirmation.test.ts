import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org-1';

const { dbSelectRows, getOrCreateAgentConfig, getLead, getListingDetails, sendVisitMessage } = vi.hoisted(() => ({
  dbSelectRows: [] as unknown[],
  getOrCreateAgentConfig: vi.fn(async () => ({ timezone: 'America/Lima' })),
  getLead: vi.fn(async () => null as unknown),
  getListingDetails: vi.fn(async () => ({ id: 'listing-1', title: 'Depa Sol' }) as unknown),
  sendVisitMessage: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => dbSelectRows) })) })) })),
  },
}));
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/lead', () => ({ getLead }));
vi.mock('@/lib/agent/listings', () => ({ getListingDetails }));
vi.mock('@/lib/agent/visits/messaging', () => ({ sendVisitMessage }));

import { isVoiceConfirmText, sendVoiceVisitConfirmation } from '@/lib/agent/voice/visit-confirmation';

describe('agent/voice/visit-confirmation — isVoiceConfirmText', () => {
  it('matches the bare quick-reply text, case/accent-insensitively', () => {
    expect(isVoiceConfirmText('Confirmar visita')).toBe(true);
    expect(isVoiceConfirmText('confirmar visita')).toBe(true);
    expect(isVoiceConfirmText('CONFIRMAR VISITA')).toBe(true);
    expect(isVoiceConfirmText('  Confirmar visita  ')).toBe(true);
  });

  it('does not match a typed code or unrelated text', () => {
    expect(isVoiceConfirmText('Confirmo VOZ-ABCDEF')).toBe(false);
    expect(isVoiceConfirmText('hola')).toBe(false);
    expect(isVoiceConfirmText(null)).toBe(false);
  });
});

const PENDING_CODE = {
  id: 'code-1',
  orgId: ORG_ID,
  code: 'VOZ-ABCDEF',
  status: 'pending',
  expiresAt: new Date(Date.now() + 3600_000),
  targetPhone: '+51987654321',
  startsAt: new Date('2026-10-05T14:00:00.000Z'),
  visitMinutes: 45,
  leadId: 'lead-1',
  listingId: 'listing-1',
};

describe('agent/voice/visit-confirmation — sendVoiceVisitConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectRows.length = 0;
    getOrCreateAgentConfig.mockResolvedValue({ timezone: 'America/Lima' });
    getLead.mockResolvedValue({ id: 'lead-1', fullName: 'Juan Perez', doNotContact: false });
    getListingDetails.mockResolvedValue({ id: 'listing-1', title: 'Depa Sol' });
    sendVisitMessage.mockResolvedValue({ success: true });
  });

  it('no-ops silently when the codeId is missing from the payload', async () => {
    await sendVoiceVisitConfirmation({}, ORG_ID);
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('no-ops when the code is not found', async () => {
    dbSelectRows.push();
    await sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID);
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('no-ops when the code has already been redeemed', async () => {
    dbSelectRows.push({ ...PENDING_CODE, status: 'redeemed' });
    await sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID);
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('no-ops when the code has expired', async () => {
    dbSelectRows.push({ ...PENDING_CODE, expiresAt: new Date(Date.now() - 1000) });
    await sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID);
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('no-ops when the lead is do_not_contact', async () => {
    dbSelectRows.push(PENDING_CODE);
    getLead.mockResolvedValue({ id: 'lead-1', fullName: 'Juan Perez', doNotContact: true });
    await sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID);
    expect(sendVisitMessage).not.toHaveBeenCalled();
  });

  it('sends the button + template with the VOZ- code, to target_phone only', async () => {
    dbSelectRows.push(PENDING_CODE);
    await sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID);

    expect(sendVisitMessage).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      phone: '+51987654321',
      buttons: [expect.objectContaining({ title: 'Confirmo VOZ-ABCDEF' })],
      template: expect.objectContaining({
        name: 'confirmar_visita_voz',
        bodyParams: ['Juan', 'Depa Sol', expect.any(String), 'VOZ-ABCDEF'],
      }),
      meta: { kind: 'voice_visit_confirmation', codeId: 'code-1' },
    }));
  });

  it('throws (for job-queue retry) when sendVisitMessage fails', async () => {
    dbSelectRows.push(PENDING_CODE);
    sendVisitMessage.mockResolvedValue({ success: false, error: 'window_closed' });
    await expect(sendVoiceVisitConfirmation({ codeId: 'code-1' }, ORG_ID)).rejects.toThrow();
  });
});
