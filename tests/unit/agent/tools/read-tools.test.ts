import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchListings, getListingDetails, rememberSessionListings, isListingKnownToSession } = vi.hoisted(() => ({
  searchListings: vi.fn(async () => [] as unknown[]),
  getListingDetails: vi.fn(async () => null as unknown),
  rememberSessionListings: vi.fn(async () => {}),
  isListingKnownToSession: vi.fn(async () => true),
}));

vi.mock('@/lib/agent/listings', () => ({ searchListings, getListingDetails }));
vi.mock('@/lib/agent/session-listings', () => ({ rememberSessionListings, isListingKnownToSession }));

import { makeSearchListingsTool } from '@/lib/agent/tools/search-listings';
import { makeGetListingDetailsTool } from '@/lib/agent/tools/get-listing-details';
import { makeSendListingCardTool } from '@/lib/agent/tools/send-listing-card';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: null },
    attribution: null,
    webSessionId: null,
    shadowMode: false,
    whatsappConversationId: 'conv-1',
    voiceCallId: null,
  };
}

describe('search_listings tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes every search to ctx.orgId, regardless of what the model asks for', async () => {
    const ctx = makeCtx();
    const tool = makeSearchListingsTool(ctx);
    await tool.run({ zone: 'Miraflores' });
    expect(searchListings).toHaveBeenCalledWith('org-1', { zone: 'Miraflores' });
  });

  it('returns a clear message instead of an empty array when nothing matches', async () => {
    const tool = makeSearchListingsTool(makeCtx());
    const result = await tool.run({});
    expect(String(result)).toMatch(/no se encontraron/i);
  });

  it('serializes results as JSON when there are matches', async () => {
    searchListings.mockResolvedValueOnce([{ id: 'l1', title: 'Depa' }]);
    const tool = makeSearchListingsTool(makeCtx());
    const result = await tool.run({});
    expect(JSON.parse(String(result))).toEqual([{ id: 'l1', title: 'Depa' }]);
  });

  it('remembers every returned id against the session, so send_listing_card/photos can later act on them', async () => {
    searchListings.mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }]);
    const tool = makeSearchListingsTool(makeCtx());
    await tool.run({});
    expect(rememberSessionListings).toHaveBeenCalledWith('org-1', 'session-1', ['l1', 'l2'], 'search');
  });
});

describe('get_listing_details tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is scoped to ctx.orgId — a listing from another org looks the same as a non-existent one', async () => {
    const tool = makeGetListingDetailsTool(makeCtx());
    const result = await tool.run({ listingId: '00000000-0000-0000-0000-000000000099' });
    expect(getListingDetails).toHaveBeenCalledWith('org-1', '00000000-0000-0000-0000-000000000099');
    expect(String(result)).toMatch(/no se encontró/i);
  });
});

describe('send_listing_card tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('formats a card with price when set', async () => {
    getListingDetails.mockResolvedValueOnce({
      id: 'l1', title: 'Depa Sol', price: '1500', currency: 'PEN', zone: 'Miraflores', bedrooms: 2, areaM2: '60', petsAllowed: true,
    });
    const tool = makeSendListingCardTool(makeCtx());
    const card = String(await tool.run({ listingId: 'l1' }));
    expect(card).toContain('Depa Sol');
    expect(card).toContain('PEN 1500');
    expect(card).not.toMatch(/a consultar/);
  });

  it('says "a consultar" instead of inventing a price when price is null', async () => {
    getListingDetails.mockResolvedValueOnce({
      id: 'l1', title: 'Depa', price: null, currency: 'PEN', zone: null, bedrooms: null, areaM2: null, petsAllowed: null,
    });
    const tool = makeSendListingCardTool(makeCtx());
    const card = String(await tool.run({ listingId: 'l1' }));
    expect(card).toMatch(/a consultar/);
  });

  it('rejects an id the session never saw with search_listings, without even calling getListingDetails', async () => {
    isListingKnownToSession.mockResolvedValueOnce(false);
    const tool = makeSendListingCardTool(makeCtx());
    const result = await tool.run({ listingId: 'guessed-id' });
    expect(getListingDetails).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/primero buscá/i);
  });
});
