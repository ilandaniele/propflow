/**
 * Integration tests for GET /api/public/listing-image/[imageId].
 *
 * Covers:
 *   - unpublished/reserved listing -> 404
 *   - org with public pages disabled and web channel disabled -> 404
 *   - rate limit -> 429
 *   - happy path -> 302 + Cache-Control
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const IMAGE_ID = '550e8400-e29b-41d4-a716-446655440030';
const ORG_ID = '550e8400-e29b-41d4-a716-446655440031';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

let selectQueue: unknown[][] = [];
const mockSelect = vi.fn(() => makeChain(selectQueue.shift() ?? []));

vi.mock('@/lib/db', () => ({
  db: { select: (...a: unknown[]) => mockSelect(...a) },
}));

const mockGetOrCreateAgentConfig = vi.fn();
vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: (...a: unknown[]) => mockGetOrCreateAgentConfig(...a),
}));

const mockGetSignedUrl = vi.fn();
vi.mock('@/lib/storage/index', () => ({
  getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a),
}));

const mockRateLimit = vi.fn();
vi.mock('@/lib/ratelimit', () => ({
  publicAssetRateLimit: (...a: unknown[]) => mockRateLimit(...a),
  getClientIp: () => '203.0.113.5',
}));

import { GET } from '@/app/api/public/listing-image/[imageId]/route';

function makeRequest(src: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/public/listing-image/${IMAGE_ID}?src=${src}`));
}

function callParams() {
  return { params: Promise.resolve({ imageId: IMAGE_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  mockRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
  mockGetOrCreateAgentConfig.mockResolvedValue({ publicPagesEnabled: true, channelsEnabled: { web: false }, widgetAllowedOrigins: [] });
  mockGetSignedUrl.mockResolvedValue('https://tigris.example/signed?x=1');
});

describe('GET /api/public/listing-image/[imageId]', () => {
  it('429s when the IP rate limit is exceeded', async () => {
    mockRateLimit.mockReturnValue({ success: false, retryAfterMs: 5000 });
    const res = await GET(makeRequest('unit'), callParams());
    expect(res.status).toBe(429);
  });

  it('404s on an unpublished/reserved listing', async () => {
    selectQueue.push([{ path: 'org/unit/uuid.jpg', orgId: ORG_ID, unitId: 'unit-1' }]); // unitImages row
    selectQueue.push([{ published: false, status: 'available' }]); // listings row — unpublished

    const res = await GET(makeRequest('unit'), callParams());
    expect(res.status).toBe(404);
  });

  it('404s when the org has public pages disabled and the web channel disabled', async () => {
    selectQueue.push([{ path: 'org/unit/uuid.jpg', orgId: ORG_ID, unitId: 'unit-1' }]);
    selectQueue.push([{ published: true, status: 'available' }]);
    mockGetOrCreateAgentConfig.mockResolvedValue({ publicPagesEnabled: false, channelsEnabled: { web: false }, widgetAllowedOrigins: [] });

    const res = await GET(makeRequest('unit'), callParams());
    expect(res.status).toBe(404);
  });

  it('404s on an unknown imageId', async () => {
    selectQueue.push([]); // unitImages: not found

    const res = await GET(makeRequest('unit'), callParams());
    expect(res.status).toBe(404);
  });

  it('happy path (unit image): 302 to a fresh signed URL, cached', async () => {
    selectQueue.push([{ path: 'org/unit/uuid.jpg', orgId: ORG_ID, unitId: 'unit-1' }]);
    selectQueue.push([{ published: true, status: 'available' }]);

    const res = await GET(makeRequest('unit'), callParams());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://tigris.example/signed?x=1');
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
    expect(mockGetSignedUrl).toHaveBeenCalledWith('unit-images', 'org/unit/uuid.jpg', 3600);
  });

  it('happy path (listing image): 302 to a fresh signed URL', async () => {
    selectQueue.push([{ path: 'org/listing/uuid.jpg', orgId: ORG_ID, listingId: 'listing-1' }]);
    selectQueue.push([{ published: true, status: 'available' }]);

    const res = await GET(makeRequest('listing'), callParams());
    expect(res.status).toBe(302);
    expect(mockGetSignedUrl).toHaveBeenCalledWith('listing-images', 'org/listing/uuid.jpg', 3600);
  });

  it('rejects an invalid src value', async () => {
    const res = await GET(makeRequest('bogus'), callParams());
    expect(res.status).toBe(404);
  });
});
