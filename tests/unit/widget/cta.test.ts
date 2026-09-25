import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getLatestPendingCode, createHandoffCode, buildWhatsAppDeepLink } = vi.hoisted(() => ({
  getLatestPendingCode: vi.fn(),
  createHandoffCode: vi.fn(),
  buildWhatsAppDeepLink: vi.fn((phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`),
}));

vi.mock('@/lib/widget/handoff-codes', () => ({ getLatestPendingCode, createHandoffCode, buildWhatsAppDeepLink }));

import { computeWebCta } from '@/lib/widget/cta';

const ORG_ID = 'org-1';
const WEB_SESSION_ID = 'ws-1';

describe('computeWebCta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the org has no WhatsApp display phone, even with a pending code', async () => {
    getLatestPendingCode.mockResolvedValue({ id: 'c1', code: 'WEB-AAAAAA', kind: 'visit' });
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: null, displayPhone: null, forceContinue: false });
    expect(cta).toBeNull();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('returns a link for an existing pending code, without creating a new one', async () => {
    getLatestPendingCode.mockResolvedValue({ id: 'c1', code: 'WEB-AAAAAA', kind: 'visit' });
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: 'lead-1', displayPhone: '+51999999999', forceContinue: false });
    expect(cta).toEqual({
      kind: 'whatsapp',
      url: expect.stringContaining('wa.me'),
      label: 'Confirmar visita por WhatsApp',
      code: 'WEB-AAAAAA',
      purpose: 'visit',
    });
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('with no pending code and forceContinue=false, returns null without creating a code', async () => {
    getLatestPendingCode.mockResolvedValue(null);
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: 'lead-1', displayPhone: '+51999999999', forceContinue: false });
    expect(cta).toBeNull();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it('forceContinue=true creates a continue code when there is no pending one', async () => {
    getLatestPendingCode.mockResolvedValue(null);
    createHandoffCode.mockResolvedValue({ id: 'c2', code: 'WEB-BBBBBB', kind: 'continue' });
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: 'lead-1', displayPhone: '+51999999999', forceContinue: true });
    expect(createHandoffCode).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, kind: 'continue', leadId: 'lead-1' }));
    expect(cta).toEqual(expect.objectContaining({ label: 'Seguir por WhatsApp', code: 'WEB-BBBBBB', purpose: 'continue' }));
  });

  it('forceContinue=true reuses an existing pending code instead of creating a second one', async () => {
    getLatestPendingCode.mockResolvedValue({ id: 'c1', code: 'WEB-AAAAAA', kind: 'visit' });
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: 'lead-1', displayPhone: '+51999999999', forceContinue: true });
    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(cta?.purpose).toBe('visit');
  });

  it('the WhatsApp deep link text embeds the code', async () => {
    getLatestPendingCode.mockResolvedValue({ id: 'c1', code: 'WEB-CCCCCC', kind: 'visit' });
    const cta = await computeWebCta({ orgId: ORG_ID, webSessionId: WEB_SESSION_ID, leadId: 'lead-1', displayPhone: '+51999999999', forceContinue: false });
    expect(buildWhatsAppDeepLink).toHaveBeenCalledWith('+51999999999', expect.stringContaining('WEB-CCCCCC'));
    expect(cta?.url).toContain(encodeURIComponent('WEB-CCCCCC'));
  });
});
