import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'org-1';
const WA_SESSION_ID = 'wa-session-1';
const PHONE = '+51987654321';

const {
  claimHandoffCode,
  finishHandoffCode,
  getOrCreateAgentConfig,
  getListingDetails,
  bookVisit,
  setSessionLead,
  recordAgentEvent,
  updateSet,
  updateWhere,
} = vi.hoisted(() => ({
  claimHandoffCode: vi.fn(),
  finishHandoffCode: vi.fn(async () => {}),
  getOrCreateAgentConfig: vi.fn(async () => ({ timezone: 'America/Lima' })),
  getListingDetails: vi.fn(async () => ({ id: 'listing-1', title: 'Depa Sol' })),
  bookVisit: vi.fn(),
  setSessionLead: vi.fn(async () => {}),
  recordAgentEvent: vi.fn(async () => {}),
  updateSet: vi.fn(() => ({ where: updateWhereImpl })),
  updateWhere: vi.fn(async () => {}),
}));

function updateWhereImpl(...args: unknown[]) {
  return updateWhere(...args);
}

vi.mock('@/lib/widget/handoff-codes', async () => {
  const actual = await vi.importActual<typeof import('@/lib/widget/handoff-codes')>('@/lib/widget/handoff-codes');
  return { ...actual, claimHandoffCode, finishHandoffCode };
});
vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/listings', () => ({ getListingDetails }));
vi.mock('@/lib/agent/visits/service', () => ({ bookVisit }));
vi.mock('@/lib/agent/session', () => ({ setSessionLead }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));
vi.mock('@/lib/db', () => ({
  db: { update: vi.fn(() => ({ set: updateSet })) },
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

describe('redeemWebHandoffCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bookVisit.mockResolvedValue({ ok: true, visit: { id: 'visit-1' } });
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
});
