/**
 * Unit tests for generateMetadata in /p/<orgSlug>/<listingSlug>/page.tsx.
 *
 * The dynamic opengraph-image route was replaced by static metadata so
 * @vercel/og stays out of the Cloudflare worker bundle. Covers:
 * 1. A listing with a cover uses the stable cover redirect route (absolute URL).
 * 2. A listing without a cover falls back to the static /og-default.png.
 * 3. Unknown org / listing return empty metadata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getPublicOrg, getPublicListing } = vi.hoisted(() => ({
  getPublicOrg: vi.fn(),
  getPublicListing: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('@/lib/public/catalog', () => ({ getPublicOrg, getPublicListing }));
vi.mock('@/lib/widget/origins', () => ({ getAppOrigin: () => 'https://app.example.com' }));
vi.mock('@/lib/widget/channel', () => ({ getWhatsAppDisplayPhone: vi.fn() }));
vi.mock('@/lib/widget/handoff-codes', () => ({ buildWhatsAppDeepLink: vi.fn() }));

import { generateMetadata } from '@/app/p/[orgSlug]/[listingSlug]/page';

const ORG = { id: 'org-1', name: 'Acme Realty', slug: 'acme' };
const LISTING = {
  slug: 'depa-sol',
  title: 'Depa con vista',
  description: 'Bonito depa',
  coverImageUrl: '/api/public/listing-image/img-1?src=unit',
};

const params = Promise.resolve({ orgSlug: 'acme', listingSlug: 'depa-sol' });

beforeEach(() => {
  vi.clearAllMocks();
  getPublicOrg.mockResolvedValue(ORG);
  getPublicListing.mockResolvedValue(LISTING);
});

describe('listing page generateMetadata og:image', () => {
  it('points at the cover redirect route as an absolute URL', async () => {
    const metadata = await generateMetadata({ params });
    expect(metadata.openGraph?.images).toEqual([
      'https://app.example.com/api/public/listing-image/img-1?src=unit',
    ]);
  });

  it('falls back to the static default image when the listing has no cover', async () => {
    getPublicListing.mockResolvedValue({ ...LISTING, coverImageUrl: null });
    const metadata = await generateMetadata({ params });
    expect(metadata.openGraph?.images).toEqual(['https://app.example.com/og-default.png']);
  });

  it('returns empty metadata for an unknown org', async () => {
    getPublicOrg.mockResolvedValue(null);
    expect(await generateMetadata({ params })).toEqual({});
  });

  it('returns empty metadata for an unknown listing', async () => {
    getPublicListing.mockResolvedValue(null);
    expect(await generateMetadata({ params })).toEqual({});
  });
});
