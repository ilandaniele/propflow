/**
 * Unit tests for /p/<orgSlug>/<listingSlug>/opengraph-image.tsx.
 *
 * Covers:
 * 1. revalidate = 600 (route segment config, so crawlers don't re-render/re-fetch every hit).
 * 2. Rate-limited requests never fetch the cover — placeholder only.
 * 3. The cover fetch is capped at 5 MB via Content-Length AND while streaming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getPublicOrg, getPublicListing, getAppOrigin, publicAssetRateLimit, getClientIp, headers, ImageResponse } = vi.hoisted(() => ({
  getPublicOrg: vi.fn(),
  getPublicListing: vi.fn(),
  getAppOrigin: vi.fn(() => 'https://app.example.com'),
  publicAssetRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '203.0.113.5'),
  headers: vi.fn(async () => new Map()),
  ImageResponse: vi.fn().mockImplementation(function (this: unknown, element: unknown, opts: unknown) {
    return { element, opts };
  }),
}));

vi.mock('next/headers', () => ({ headers }));
vi.mock('next/og', () => ({ ImageResponse }));
vi.mock('@/lib/public/catalog', () => ({ getPublicOrg, getPublicListing }));
vi.mock('@/lib/widget/origins', () => ({ getAppOrigin }));
vi.mock('@/lib/ratelimit', () => ({ publicAssetRateLimit, getClientIp }));

const globalFetch = vi.fn();
vi.stubGlobal('fetch', globalFetch);

import Image, { revalidate } from '@/app/p/[orgSlug]/[listingSlug]/opengraph-image';

const ORG = { id: 'org-1', name: 'Acme Realty', slug: 'acme' };
const LISTING = {
  slug: 'depa-sol', title: 'Depa con vista', price: '1500.00', currency: 'PEN', zone: 'Miraflores',
  coverImageUrl: '/api/public/listing-image/img-1?src=unit',
};

function makeBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return {
    getReader() {
      return {
        read: async () => {
          if (i < chunks.length) return { done: false, value: chunks[i++] };
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPublicOrg.mockResolvedValue(ORG);
  getPublicListing.mockResolvedValue(LISTING);
  publicAssetRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
  headers.mockResolvedValue(new Map());
});

describe('opengraph-image route segment config', () => {
  it('sets revalidate = 600', () => {
    expect(revalidate).toBe(600);
  });
});

describe('opengraph-image rate limiting', () => {
  it('never fetches the cover when rate-limited — returns a placeholder', async () => {
    publicAssetRateLimit.mockReturnValue({ success: false, retryAfterMs: 5000 });
    await Image({ params: Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' }) });
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('fetches the cover when not rate-limited', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', '10'], ['content-type', 'image/jpeg']]),
      body: makeBody([new Uint8Array([1, 2, 3])]),
    });
    await Image({ params: Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' }) });
    expect(globalFetch).toHaveBeenCalledWith('https://app.example.com/api/public/listing-image/img-1?src=unit');
  });
});

describe('opengraph-image cover size cap', () => {
  it('skips the cover when Content-Length exceeds 5 MB', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', String(6 * 1024 * 1024)], ['content-type', 'image/jpeg']]),
      body: makeBody([]),
    });
    await Image({ params: Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' }) });
    // ImageResponse constructor was called without a backgroundImage data URL.
    const call = ImageResponse.mock.calls[0];
    const jsx = call[0] as { props: { style: { backgroundImage?: string } } };
    expect(jsx.props.style.backgroundImage).toBeUndefined();
  });

  it('aborts and skips the cover when the stream exceeds 5 MB despite no/lying Content-Length', async () => {
    const bigChunk = new Uint8Array(3 * 1024 * 1024);
    globalFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'image/jpeg']]), // no content-length
      body: makeBody([bigChunk, bigChunk, bigChunk]), // 9 MB total, streamed
    });
    await Image({ params: Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' }) });
    const call = ImageResponse.mock.calls[0];
    const jsx = call[0] as { props: { style: { backgroundImage?: string } } };
    expect(jsx.props.style.backgroundImage).toBeUndefined();
  });

  it('embeds the cover as a data URL when under the cap', async () => {
    globalFetch.mockResolvedValue({
      ok: true,
      headers: new Map([['content-length', '3'], ['content-type', 'image/jpeg']]),
      body: makeBody([new Uint8Array([1, 2, 3])]),
    });
    await Image({ params: Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' }) });
    const call = ImageResponse.mock.calls[0];
    const jsx = call[0] as { props: { style: { backgroundImage?: string } } };
    expect(jsx.props.style.backgroundImage).toMatch(/^url\(data:image\/jpeg;base64,/);
  });
});
