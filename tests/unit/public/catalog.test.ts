/**
 * Unit tests for the public catalogue projection (src/lib/public/catalog.ts).
 *
 * Covers:
 * 1. Exact key whitelist of both projections (no unitId/propertyId ever leaks).
 * 2. getPublicOrg — null when public_pages_enabled=false; webPublicKey only when the web channel is enabled.
 * 3. listPublicListings — total counts all matching rows, not just the page; cover image resolution (unit vs listing).
 * 4. getPublicListing — null for unpublished/reserved/other-org/unknown-slug listings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> & { then: Promise<unknown[]>['then'] } = {} as never;
  for (const m of ['from', 'where', 'limit', 'offset', 'orderBy']) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain);
  }
  chain.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

// Queue-based db.select mock: each test enqueues the rows for every db.select
// call it expects, in call order.
let selectQueue: unknown[][] = [];
const mockSelect = vi.fn(() => makeChain(selectQueue.shift() ?? []));

vi.mock('@/lib/db', () => ({
  db: { select: (...a: unknown[]) => mockSelect(...a) },
}));

const mockGetOrgWebChannel = vi.fn();
vi.mock('@/lib/widget/channel', () => ({
  getOrgWebChannel: (...a: unknown[]) => mockGetOrgWebChannel(...a),
}));

import { getPublicOrg, listPublicListings, getPublicListing, publicImageUrl } from '@/lib/public/catalog';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440020';

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  mockGetOrgWebChannel.mockResolvedValue(null);
});

describe('publicImageUrl', () => {
  it('builds a redirect-route URL carrying the src', () => {
    expect(publicImageUrl('img-1', 'unit')).toBe('/api/public/listing-image/img-1?src=unit');
    expect(publicImageUrl('img-2', 'listing')).toBe('/api/public/listing-image/img-2?src=listing');
  });
});

describe('getPublicOrg', () => {
  it('returns null when the org has no slug/does not exist', async () => {
    selectQueue.push([]);
    const org = await getPublicOrg('unknown-slug');
    expect(org).toBeNull();
  });

  it('returns null when public_pages_enabled is false', async () => {
    selectQueue.push([{ id: ORG_ID, name: 'Acme', slug: 'acme' }]);
    selectQueue.push([{ publicPagesEnabled: false }]);
    const org = await getPublicOrg('acme');
    expect(org).toBeNull();
  });

  it('returns null (read-only, never creates a row) when the org has no agent_configs row yet', async () => {
    selectQueue.push([{ id: ORG_ID, name: 'Acme', slug: 'acme' }]);
    selectQueue.push([]); // no agent_configs row for this org
    const org = await getPublicOrg('acme');
    expect(org).toBeNull();
  });

  it('omits webPublicKey when the web channel is not enabled', async () => {
    selectQueue.push([{ id: ORG_ID, name: 'Acme', slug: 'acme' }]);
    selectQueue.push([{ publicPagesEnabled: true }]);
    mockGetOrgWebChannel.mockResolvedValue({ enabled: false, publicKey: 'pk_x' });
    const org = await getPublicOrg('acme');
    expect(org).toEqual({ id: ORG_ID, name: 'Acme', slug: 'acme', webPublicKey: null });
  });

  it('includes webPublicKey when the web channel is enabled', async () => {
    selectQueue.push([{ id: ORG_ID, name: 'Acme', slug: 'acme' }]);
    selectQueue.push([{ publicPagesEnabled: true }]);
    mockGetOrgWebChannel.mockResolvedValue({ enabled: true, publicKey: 'pk_x' });
    const org = await getPublicOrg('acme');
    expect(org?.webPublicKey).toBe('pk_x');
  });
});

describe('listPublicListings', () => {
  it('total counts all matching rows, not just the returned page', async () => {
    selectQueue.push([{
      id: 'listing-1', unitId: null, publicSlug: 'depa-abc123', title: 'Depa', operation: 'rent',
      price: '1500.00', currency: 'PEN', zone: 'Miraflores', bedrooms: 2, bathrooms: 1, areaM2: '60',
    }]); // page of rows
    selectQueue.push([{ count: 57 }]); // total count (over all rows, not the 24/page cap)
    selectQueue.push([]); // resolveCoverImageUrls: listingImages (no unitId on this row)

    const { items, total } = await listPublicListings(ORG_ID, {});
    expect(total).toBe(57);
    expect(items).toHaveLength(1);
  });

  it('returns only the whitelisted card keys — no unitId/propertyId', async () => {
    selectQueue.push([{
      id: 'listing-1', unitId: 'unit-1', publicSlug: 'depa-abc123', title: 'Depa', operation: 'rent',
      price: '1500.00', currency: 'PEN', zone: 'Miraflores', bedrooms: 2, bathrooms: 1, areaM2: '60',
    }]);
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([{ id: 'img-1', unitId: 'unit-1' }]); // resolveCoverImageUrls: unit_images branch

    const { items } = await listPublicListings(ORG_ID, {});
    expect(Object.keys(items[0]).sort()).toEqual(
      ['areaM2', 'bathrooms', 'bedrooms', 'coverImageUrl', 'currency', 'operation', 'price', 'slug', 'title', 'zone'].sort(),
    );
    expect(items[0].coverImageUrl).toBe('/api/public/listing-image/img-1?src=unit');
    expect((items[0] as unknown as { unitId?: string }).unitId).toBeUndefined();
    expect((items[0] as unknown as { propertyId?: string }).propertyId).toBeUndefined();
  });

  it('drops rows without a public_slug', async () => {
    selectQueue.push([{
      id: 'listing-1', unitId: null, publicSlug: null, title: 'Depa', operation: 'rent',
      price: null, currency: 'PEN', zone: null, bedrooms: null, bathrooms: null, areaM2: null,
    }]);
    selectQueue.push([{ count: 1 }]);
    selectQueue.push([]);

    const { items } = await listPublicListings(ORG_ID, {});
    expect(items).toHaveLength(0);
  });
});

describe('getPublicListing', () => {
  it('returns null for an unpublished/reserved/other-org/unknown-slug listing (query already filters these — empty row means "not found")', async () => {
    selectQueue.push([]); // listings select returns nothing for a filtered-out row
    const listing = await getPublicListing(ORG_ID, 'does-not-exist');
    expect(listing).toBeNull();
  });

  it('returns only the whitelisted detail keys, images capped, cover-first', async () => {
    selectQueue.push([{
      id: 'listing-1', unitId: 'unit-1', publicSlug: 'depa-abc123', title: 'Depa', operation: 'rent',
      price: '1500.00', currency: 'PEN', zone: 'Miraflores', bedrooms: 2, bathrooms: 1, areaM2: '60',
      description: 'Lindo depa', parking: true, maintenanceFee: '150.00', petsAllowed: true, refCode: 'DEP01',
    }]);
    selectQueue.push([{ id: 'img-cover' }, { id: 'img-2' }]); // unit_images, cover first

    const listing = await getPublicListing(ORG_ID, 'depa-abc123');
    expect(listing).not.toBeNull();
    expect(Object.keys(listing!).sort()).toEqual(
      ['areaM2', 'bathrooms', 'bedrooms', 'coverImageUrl', 'currency', 'description', 'imageUrls', 'maintenanceFee',
        'operation', 'parking', 'petsAllowed', 'price', 'refCode', 'slug', 'title', 'zone'].sort(),
    );
    expect(listing!.imageUrls).toEqual([
      '/api/public/listing-image/img-cover?src=unit',
      '/api/public/listing-image/img-2?src=unit',
    ]);
    expect(listing!.coverImageUrl).toBe('/api/public/listing-image/img-cover?src=unit');
    expect((listing as unknown as { unitId?: string }).unitId).toBeUndefined();
  });
});
