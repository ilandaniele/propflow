import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
          limit: vi.fn(async () => rows),
        })),
      })),
    })),
  },
}));

import { searchListings, getListingDetails } from '@/lib/agent/listings';

describe('searchListings', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it('returns rows the query produces', async () => {
    rows.push({ id: 'l1', operation: 'rent', price: null, currency: 'PEN', title: 'A', zone: 'Z', bedrooms: 2, bathrooms: 1, areaM2: '50', petsAllowed: null });
    const result = await searchListings('org-1', { operation: 'rent' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('l1');
  });

  it('returns an empty array when nothing matches', async () => {
    const result = await searchListings('org-1', { zone: 'Nowhere' });
    expect(result).toEqual([]);
  });
});

describe('getListingDetails', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it('returns the listing when found', async () => {
    rows.push({ id: 'l1', operation: 'sale', price: '100000', currency: 'PEN', title: 'Casa', description: 'linda', zone: 'Z', bedrooms: 3, bathrooms: 2, areaM2: '120', petsAllowed: true, maintenanceFee: null, publicSlug: null });
    const result = await getListingDetails('org-1', 'l1');
    expect(result?.id).toBe('l1');
  });

  it('returns null for an unknown, unpublished, or cross-org id', async () => {
    const result = await getListingDetails('org-1', 'does-not-exist');
    expect(result).toBeNull();
  });
});
