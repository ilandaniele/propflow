import { describe, it, expect } from 'vitest';
import { planDeliveries, tallyDeliveries, toTemplateParam, type RecipientRow } from '@/lib/announcements/recipients';

const row = (overrides: Partial<RecipientRow> & { tenantId: string }): RecipientRow => ({
  email: `${overrides.tenantId}@example.com`,
  whatsappPhone: '+51900000000',
  whatsappOptIn: true,
  announcementsEmail: null,
  ...overrides,
});

describe('planDeliveries', () => {
  it('plans one delivery per requested channel for a reachable tenant', () => {
    expect(planDeliveries([row({ tenantId: 'a' })], ['email', 'whatsapp'])).toEqual([
      { tenantId: 'a', channel: 'email' },
      { tenantId: 'a', channel: 'whatsapp' },
    ]);
  });

  it('only plans the requested channels', () => {
    expect(planDeliveries([row({ tenantId: 'a' })], ['whatsapp'])).toEqual([{ tenantId: 'a', channel: 'whatsapp' }]);
    expect(planDeliveries([row({ tenantId: 'a' })], [])).toEqual([]);
  });

  it('skips email for tenants without an address or who opted out of announcements', () => {
    const rows = [
      row({ tenantId: 'no-email', email: null }),
      row({ tenantId: 'opted-out', announcementsEmail: false }),
      row({ tenantId: 'opted-in', announcementsEmail: true }),
    ];
    expect(planDeliveries(rows, ['email'])).toEqual([{ tenantId: 'opted-in', channel: 'email' }]);
  });

  it('skips WhatsApp without a phone or without opt-in', () => {
    const rows = [
      row({ tenantId: 'no-phone', whatsappPhone: null }),
      row({ tenantId: 'no-consent', whatsappOptIn: false }),
      row({ tenantId: 'ok' }),
    ];
    expect(planDeliveries(rows, ['whatsapp'])).toEqual([{ tenantId: 'ok', channel: 'whatsapp' }]);
  });

  it('dedupes tenants with several active contracts', () => {
    expect(planDeliveries([row({ tenantId: 'a' }), row({ tenantId: 'a' })], ['email'])).toHaveLength(1);
  });
});

describe('toTemplateParam', () => {
  it('flattens newlines, tabs and repeated spaces', () => {
    expect(toTemplateParam(' Hola\n\nmundo\t   cruel ', 100)).toBe('Hola mundo cruel');
  });

  it('truncates with an ellipsis inside the limit', () => {
    const out = toTemplateParam('abcdef ghij', 8);
    expect(out).toBe('abcdef…');
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('keeps text at the limit intact', () => {
    expect(toTemplateParam('abcd', 4)).toBe('abcd');
  });
});

describe('tallyDeliveries', () => {
  it('groups counts by announcement and channel with zero defaults', () => {
    const counts = tallyDeliveries([
      { announcementId: 'x', channel: 'email', status: 'sent', total: 3 },
      { announcementId: 'x', channel: 'email', status: 'failed', total: 1 },
      { announcementId: 'x', channel: 'whatsapp', status: 'pending', total: 2 },
      { announcementId: 'y', channel: 'email', status: 'sent', total: 5 },
    ]);
    expect(counts.get('x')).toEqual({
      email: { pending: 0, sent: 3, failed: 1 },
      whatsapp: { pending: 2, sent: 0, failed: 0 },
    });
    expect(counts.get('y')).toEqual({ email: { pending: 0, sent: 5, failed: 0 } });
    expect(counts.has('z')).toBe(false);
  });
});
