import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'set', 'values', 'returning']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

import { hasWhatsAppChannel, setWhatsAppDisplayPhone } from '@/lib/widget/channel';

beforeEach(() => vi.clearAllMocks());

describe('widget/channel — WhatsApp display phone', () => {
  it('hasWhatsAppChannel is true when an org_channels(whatsapp) row exists', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ id: 'chan-1' }]));
    expect(await hasWhatsAppChannel('org-1')).toBe(true);
  });

  it('hasWhatsAppChannel is false when there is no whatsapp channel row', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));
    expect(await hasWhatsAppChannel('org-1')).toBe(false);
  });

  it('setWhatsAppDisplayPhone rejects a malformed phone', async () => {
    await expect(setWhatsAppDisplayPhone('org-1', 'not-a-phone')).rejects.toThrow(/E\.164/);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('setWhatsAppDisplayPhone(null) clears the stored number when a whatsapp row exists', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ id: 'chan-1', config: { displayPhoneE164: '+51987654321' } }]));
    const updateChain = makeChain([]);
    mockUpdate.mockReturnValueOnce(updateChain);

    const result = await setWhatsAppDisplayPhone('org-1', null);

    expect(result).toBe(true);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ displayPhoneE164: null }),
    }));
  });

  it('setWhatsAppDisplayPhone(null) is a no-op success when there is no whatsapp row', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));
    const result = await setWhatsAppDisplayPhone('org-1', null);
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('setWhatsAppDisplayPhone(phone) returns false when there is no whatsapp row to attach to', async () => {
    mockSelect.mockReturnValueOnce(makeChain([]));
    const result = await setWhatsAppDisplayPhone('org-1', '+51987654321');
    expect(result).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('setWhatsAppDisplayPhone(phone) updates config.displayPhoneE164 when the row exists', async () => {
    mockSelect.mockReturnValueOnce(makeChain([{ id: 'chan-1', config: {} }]));
    const updateChain = makeChain([]);
    mockUpdate.mockReturnValueOnce(updateChain);

    const result = await setWhatsAppDisplayPhone('org-1', '+51987654321');

    expect(result).toBe(true);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ displayPhoneE164: '+51987654321' }),
    }));
  });
});
