import { BASE_CURRENCY } from '@/lib/finance/currency';
import { roundedAverage } from './average';

export type AverageRentRow = {
  currency: string;
  propertyId: string;
  propertyName: string;
  unitType: string | null;
  bedrooms: number | null;
  contracts: number;
  rentSum: number;
};

export type AverageRentGroup = { key: string | null; contracts: number; average: number };

export type CurrencyAverageRent = {
  currency: string;
  overall: AverageRentGroup;
  byProperty: Array<AverageRentGroup & { propertyName: string }>;
  byUnitType: AverageRentGroup[];
  byBedrooms: AverageRentGroup[];
};

type Totals = { contracts: number; rentSum: number };

function addTo<K>(map: Map<K, Totals>, key: K, row: Totals) {
  const totals = map.get(key) ?? { contracts: 0, rentSum: 0 };
  map.set(key, { contracts: totals.contracts + row.contracts, rentSum: totals.rentSum + row.rentSum });
}

function toGroup(key: string | null, totals: Totals): AverageRentGroup {
  return { key, contracts: totals.contracts, average: roundedAverage(totals.rentSum, totals.contracts, 2) ?? 0 };
}

function nullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

function sortedGroups(map: Map<string | null, Totals>): AverageRentGroup[] {
  return [...map].map(([key, totals]) => toGroup(key, totals)).sort((a, b) => nullsLast(a.key, b.key));
}

function summarizeCurrency(currency: string, rows: AverageRentRow[]): CurrencyAverageRent {
  const overall: Totals = { contracts: 0, rentSum: 0 };
  const byProperty = new Map<string, Totals>();
  const byUnitType = new Map<string | null, Totals>();
  const byBedrooms = new Map<string | null, Totals>();
  const propertyNames = new Map<string, string>();

  for (const row of rows) {
    overall.contracts += row.contracts;
    overall.rentSum += row.rentSum;
    addTo(byProperty, row.propertyId, row);
    addTo(byUnitType, row.unitType?.trim() || null, row);
    addTo(byBedrooms, row.bedrooms === null ? null : String(row.bedrooms), row);
    propertyNames.set(row.propertyId, row.propertyName);
  }

  return {
    currency,
    overall: toGroup(null, overall),
    byProperty: [...byProperty]
      .map(([key, totals]) => ({ ...toGroup(key, totals), propertyName: propertyNames.get(key) ?? '' }))
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
    byUnitType: sortedGroups(byUnitType),
    byBedrooms: sortedGroups(byBedrooms),
  };
}

export function summarizeAverageRent(rows: AverageRentRow[]): CurrencyAverageRent[] {
  const byCurrency = new Map<string, AverageRentRow[]>();
  for (const row of rows) byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row]);
  return [...byCurrency]
    .sort(([a], [b]) => (a === BASE_CURRENCY ? -1 : b === BASE_CURRENCY ? 1 : a.localeCompare(b)))
    .map(([currency, currencyRows]) => summarizeCurrency(currency, currencyRows));
}
