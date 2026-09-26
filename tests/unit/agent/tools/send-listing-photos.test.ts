import { describe, it, expect, vi, beforeEach } from 'vitest';

// A single chainable mock query builder: every chain method (from/where/
// limit/orderBy) returns itself, and awaiting it at any point resolves to
// the next queued result — so one mock covers every shape of chain the tool
// builds (select…limit, select…orderBy…limit, select…where with no limit).
let queue: unknown[] = [];

function resetQueue() {
  queue = [];
}

function makeChain(): unknown {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    then: (resolve: (v: unknown) => void) => resolve(queue.shift() ?? []),
  };
  return chain;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => makeChain()),
  },
}));

const { getOrCreateAgentConfig, isListingKnownToSession, sendWhatsAppImage, getSignedUrl, recordAgentEvent } = vi.hoisted(() => ({
  getOrCreateAgentConfig: vi.fn(async () => ({ maxListingPhotos: 5 }) as unknown),
  isListingKnownToSession: vi.fn(async () => true),
  sendWhatsAppImage: vi.fn(async () => ({ ok: true, messageId: 'm1' }) as unknown),
  getSignedUrl: vi.fn(async (_b: string, path: string) => `https://signed.example/${path}`),
  recordAgentEvent: vi.fn(async () => {}),
}));

vi.mock('@/lib/agent/config', () => ({ getOrCreateAgentConfig }));
vi.mock('@/lib/agent/session-listings', () => ({ isListingKnownToSession }));
vi.mock('@/lib/agent/outbound', () => ({ sendWhatsAppImage }));
vi.mock('@/lib/storage', () => ({ getSignedUrl }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent }));

import { makeSendListingPhotosTool } from '@/lib/agent/tools/send-listing-photos';
import type { AgentToolContext } from '@/lib/agent/tools/context';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    orgId: 'org-1',
    sessionId: 'session-1',
    channel: 'whatsapp',
    externalId: '+51987654321',
    dryRun: false,
    leadIdRef: { current: 'lead-1' },
    attribution: null,
    webSessionId: null,
    shadowMode: false,
    whatsappConversationId: 'conv-1',
    voiceCallId: null,
    ...overrides,
  };
}

function setQueue(values: unknown[]) {
  queue = [...values];
}

const LISTING_ID = '44444444-4444-4444-4444-444444444444';

describe('send_listing_photos tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueue();
    setQueue([]);
  });

  it('rejects an id the session never saw, without touching config or the DB further', async () => {
    isListingKnownToSession.mockResolvedValueOnce(false);
    const tool = makeSendListingPhotosTool(makeCtx());
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/primero buscá/i);
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
  });

  it('shadow mode never sends and records photos_suppressed', async () => {
    const tool = makeSendListingPhotosTool(makeCtx({ shadowMode: true }));
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/modo sombra/i);
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
    expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'photos_suppressed', sessionId: 'session-1' }));
  });

  it('dryRun describes without sending or checking session-seen state', async () => {
    const tool = makeSendListingPhotosTool(makeCtx({ dryRun: true }));
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/SIMULACIÓN/);
    expect(isListingKnownToSession).not.toHaveBeenCalled();
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
  });

  it('rejects when there is no linked whatsapp conversation (e.g. web/voice)', async () => {
    const tool = makeSendListingPhotosTool(makeCtx({ whatsappConversationId: null }));
    setQueue([[]]); // the daily-count select
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/solo se pueden enviar por whatsapp/i);
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
  });

  it('rejects after 3 calls already sent today for this session', async () => {
    setQueue([[{ batch: 'a' }, { batch: 'b' }, { batch: 'c' }]]);
    const tool = makeSendListingPhotosTool(makeCtx());
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/ya enviamos fotos/i);
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
  });

  it('sends up to config.maxListingPhotos images, cover first, via signed URLs never exposed in the result', async () => {
    setQueue([
      [], // daily count
      [{ id: LISTING_ID, title: 'Depa Sol', price: '1500', currency: 'PEN', unitId: 'unit-1' }], // listing row
      [{ path: 'unit-1/cover.jpg' }, { path: 'unit-1/2.jpg' }], // unit images
    ]);
    const tool = makeSendListingPhotosTool(makeCtx());
    const result = String(await tool.run({ listingId: LISTING_ID }));
    expect(sendWhatsAppImage).toHaveBeenCalledTimes(2);
    expect(result).toMatch(/envié 2 fotos/i);
    expect(result).not.toContain('https://signed.example');
    expect(recordAgentEvent).not.toHaveBeenCalled();
  });

  it('respects an explicit lower max than config.maxListingPhotos', async () => {
    getOrCreateAgentConfig.mockResolvedValueOnce({ maxListingPhotos: 5 });
    setQueue([
      [],
      [{ id: LISTING_ID, title: 'Depa', price: null, currency: 'PEN', unitId: null }],
      [{ path: 'listing-x/1.jpg' }],
    ]);
    const tool = makeSendListingPhotosTool(makeCtx());
    await tool.run({ listingId: LISTING_ID, max: 1 });
    expect(sendWhatsAppImage).toHaveBeenCalledTimes(1);
  });

  it('reports no photos found when the listing has none', async () => {
    setQueue([
      [],
      [{ id: LISTING_ID, title: 'Depa', price: null, currency: 'PEN', unitId: null }],
      [],
    ]);
    const tool = makeSendListingPhotosTool(makeCtx());
    const result = await tool.run({ listingId: LISTING_ID });
    expect(String(result)).toMatch(/todavía no hay fotos/i);
    expect(sendWhatsAppImage).not.toHaveBeenCalled();
  });
});
