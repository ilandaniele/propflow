import { describe, it, expect, vi, beforeEach } from 'vitest';

const { unitRows, existingListingRows, insertedValues, updateCalls } = vi.hoisted(() => ({
  unitRows: [] as unknown[],
  existingListingRows: [] as unknown[],
  insertedValues: [] as Record<string, unknown>[],
  updateCalls: [] as { set: Record<string, unknown>; where: unknown }[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn(async () => unitRows) })),
        where: vi.fn(async () => existingListingRows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        insertedValues.push(v);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((s: Record<string, unknown>) => ({
        where: vi.fn(async (w: unknown) => {
          updateCalls.push({ set: s, where: w });
        }),
      })),
    })),
  },
}));

import { syncListingsFromUnits } from '@/lib/agent/listings';

function resetRows() {
  unitRows.length = 0;
  existingListingRows.length = 0;
  insertedValues.length = 0;
  updateCalls.length = 0;
}

describe('syncListingsFromUnits', () => {
  beforeEach(() => {
    resetRows();
  });

  it('inserts a new listing for a vacant unit with no existing listing, price left unset', async () => {
    unitRows.push({
      id: 'unit-1',
      propertyId: 'prop-1',
      status: 'vacant',
      bedrooms: 2,
      areaM2: '60',
      propertyName: 'Edificio Sol',
      propertyCity: 'Miraflores',
    });

    const result = await syncListingsFromUnits('org-1');

    expect(result).toEqual({ inserted: 1, updated: 0 });
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      orgId: 'org-1',
      unitId: 'unit-1',
      operation: 'rent',
      status: 'available',
      published: true,
      bedrooms: 2,
    });
    expect(insertedValues[0].price).toBeUndefined(); // never set from monthlyRentDefault
  });

  it('inserts an occupied unit as status "closed"', async () => {
    unitRows.push({ id: 'unit-2', propertyId: 'prop-1', status: 'occupied', bedrooms: 1, areaM2: null, propertyName: 'X', propertyCity: 'Y' });

    await syncListingsFromUnits('org-1');

    expect(insertedValues[0]).toMatchObject({ status: 'closed', published: true });
  });

  it('flips an existing listing to closed when the unit becomes occupied, touching only status', async () => {
    unitRows.push({ id: 'unit-3', propertyId: 'prop-1', status: 'occupied', bedrooms: 2, areaM2: '50', propertyName: 'X', propertyCity: 'Y' });
    existingListingRows.push({ id: 'listing-3', unitId: 'unit-3', status: 'available', statusOverride: false });

    const result = await syncListingsFromUnits('org-1');

    expect(result).toEqual({ inserted: 0, updated: 1 });
    expect(insertedValues).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toMatchObject({ status: 'closed' });
    // Only status (+ updatedAt) is touched — never price, title, bedrooms, etc.
    expect(Object.keys(updateCalls[0].set).sort()).toEqual(['status', 'updatedAt'].sort());
  });

  it('never updates a listing whose status_override is true, even if availability changed', async () => {
    unitRows.push({ id: 'unit-4', propertyId: 'prop-1', status: 'occupied', bedrooms: 2, areaM2: '50', propertyName: 'X', propertyCity: 'Y' });
    existingListingRows.push({ id: 'listing-4', unitId: 'unit-4', status: 'available', statusOverride: true });

    const result = await syncListingsFromUnits('org-1');

    expect(result).toEqual({ inserted: 0, updated: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it('does nothing when the derived status already matches', async () => {
    unitRows.push({ id: 'unit-5', propertyId: 'prop-1', status: 'vacant', bedrooms: 2, areaM2: '50', propertyName: 'X', propertyCity: 'Y' });
    existingListingRows.push({ id: 'listing-5', unitId: 'unit-5', status: 'available', statusOverride: false });

    const result = await syncListingsFromUnits('org-1');

    expect(result).toEqual({ inserted: 0, updated: 0 });
  });

  it('is a no-op when there are no units', async () => {
    const result = await syncListingsFromUnits('org-1');
    expect(result).toEqual({ inserted: 0, updated: 0 });
    expect(insertedValues).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});
