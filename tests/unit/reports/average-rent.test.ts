import { describe, it, expect } from 'vitest';
import { summarizeAverageRent, type AverageRentRow } from '@/lib/reports/average-rent';

const row = (overrides: Partial<AverageRentRow>): AverageRentRow => ({
  currency: 'PEN',
  propertyId: 'p1',
  propertyName: 'Torre',
  unitType: null,
  bedrooms: null,
  contracts: 1,
  rentSum: 1000,
  ...overrides,
});

describe('summarizeAverageRent', () => {
  it('returns nothing without contracts', () => {
    expect(summarizeAverageRent([])).toEqual([]);
  });

  it('weights averages by contract count across groups', () => {
    const [pen] = summarizeAverageRent([
      row({ propertyId: 'a', propertyName: 'Torre', unitType: 'flat', bedrooms: 2, contracts: 3, rentSum: 3000 }),
      row({ propertyId: 'a', propertyName: 'Torre', unitType: 'room', bedrooms: 1, contracts: 1, rentSum: 500 }),
      row({ propertyId: 'b', propertyName: 'Casa', unitType: 'flat', bedrooms: 2, contracts: 1, rentSum: 1500 }),
    ]);

    expect(pen.overall).toEqual({ key: null, contracts: 5, average: 1000 });
    expect(pen.byProperty).toEqual([
      { key: 'b', propertyName: 'Casa', contracts: 1, average: 1500 },
      { key: 'a', propertyName: 'Torre', contracts: 4, average: 875 },
    ]);
    expect(pen.byUnitType).toEqual([
      { key: 'flat', contracts: 4, average: 1125 },
      { key: 'room', contracts: 1, average: 500 },
    ]);
    expect(pen.byBedrooms).toEqual([
      { key: '1', contracts: 1, average: 500 },
      { key: '2', contracts: 4, average: 1125 },
    ]);
  });

  it('never mixes currencies and lists the base currency first', () => {
    const report = summarizeAverageRent([
      row({ currency: 'USD', rentSum: 400 }),
      row({ currency: 'PEN', rentSum: 1200 }),
      row({ currency: 'EUR', rentSum: 300 }),
    ]);
    expect(report.map((section) => [section.currency, section.overall.average])).toEqual([
      ['PEN', 1200],
      ['EUR', 300],
      ['USD', 400],
    ]);
  });

  it('puts unspecified unit type and bedrooms last, treating blank types as unspecified', () => {
    const [pen] = summarizeAverageRent([
      row({ unitType: '  ', bedrooms: null, rentSum: 100 }),
      row({ unitType: 'studio', bedrooms: 10, rentSum: 200 }),
      row({ unitType: null, bedrooms: 3, rentSum: 300 }),
    ]);
    expect(pen.byUnitType.map((group) => group.key)).toEqual(['studio', null]);
    expect(pen.byUnitType[1]).toMatchObject({ contracts: 2, average: 200 });
    expect(pen.byBedrooms.map((group) => group.key)).toEqual(['3', '10', null]);
  });

  it('rounds averages to cents', () => {
    const [pen] = summarizeAverageRent([row({ contracts: 3, rentSum: 1000 })]);
    expect(pen.overall.average).toBe(333.33);
  });
});
