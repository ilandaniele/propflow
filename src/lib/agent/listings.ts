/**
 * Listings inventory — unified rent + sale.
 *
 * syncListingsFromUnits() derives rent listings from vacant/occupied units.
 * It is intentionally narrow: it INSERTS missing rows and, for existing
 * rows, only ever touches `status` (availability) — never price, title,
 * description, bedrooms, or any other field a human may have edited. Price
 * always starts NULL ("a consultar") because units.monthlyRentDefault is a
 * default, not a committed asking price, and because the Airtable sync that
 * feeds units.status can lag up to 24h (see docs in the Phase 1 PR).
 */

import { db } from '@/lib/db';
import { listings, units, properties } from '@/lib/db/schema';
import { and, eq, gte, lte, isNotNull, sql } from 'drizzle-orm';

export interface SyncListingsResult {
  inserted: number;
  updated: number;
}

export async function syncListingsFromUnits(orgId: string): Promise<SyncListingsResult> {
  const unitRows = await db
    .select({
      id: units.id,
      propertyId: units.propertyId,
      status: units.status,
      bedrooms: units.bedrooms,
      areaM2: units.areaM2,
      propertyName: properties.name,
      propertyCity: properties.city,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(units.orgId, orgId));

  const existingRows = await db
    .select({
      id: listings.id,
      unitId: listings.unitId,
      status: listings.status,
      statusOverride: listings.statusOverride,
    })
    .from(listings)
    .where(and(eq(listings.orgId, orgId), isNotNull(listings.unitId)));

  const existingByUnit = new Map(existingRows.map((l) => [l.unitId as string, l]));

  let inserted = 0;
  let updated = 0;

  for (const unit of unitRows) {
    const derivedStatus = unit.status === 'vacant' ? 'available' : 'closed';
    const existing = existingByUnit.get(unit.id);

    if (!existing) {
      await db.insert(listings).values({
        orgId,
        unitId: unit.id,
        propertyId: unit.propertyId,
        operation: 'rent',
        status: derivedStatus,
        published: true, // unit inventory is already trusted data — surface it immediately
        title: unit.propertyName ?? null,
        zone: unit.propertyCity ?? null,
        bedrooms: unit.bedrooms ?? null,
        areaM2: unit.areaM2 ?? null,
      });
      inserted++;
      continue;
    }

    if (existing.statusOverride) continue; // staff took manual control of availability
    if (existing.status !== derivedStatus) {
      await db.update(listings).set({ status: derivedStatus, updatedAt: new Date() }).where(eq(listings.id, existing.id));
      updated++;
    }
  }

  return { inserted, updated };
}

export interface ListingSearchFilters {
  operation?: 'rent' | 'sale';
  zone?: string;
  bedroomsMin?: number;
  budgetMax?: number;
  petsAllowed?: boolean;
}

export interface ListingSummary {
  id: string;
  operation: string;
  price: string | null;
  currency: string;
  title: string | null;
  zone: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: string | null;
  petsAllowed: boolean | null;
}

const MAX_SEARCH_RESULTS = 8;

/** Only ever returns published, available listings — never leaks reserved/closed or unpublished inventory. */
export async function searchListings(orgId: string, filters: ListingSearchFilters): Promise<ListingSummary[]> {
  const conditions = [
    eq(listings.orgId, orgId),
    eq(listings.published, true),
    eq(listings.status, 'available'),
  ];

  if (filters.operation) conditions.push(eq(listings.operation, filters.operation));
  if (filters.zone) conditions.push(sql`${listings.zone} ILIKE ${'%' + filters.zone + '%'}`);
  if (filters.bedroomsMin != null) conditions.push(gte(listings.bedrooms, filters.bedroomsMin));
  if (filters.budgetMax != null) conditions.push(lte(listings.price, String(filters.budgetMax)));
  if (filters.petsAllowed) conditions.push(eq(listings.petsAllowed, true));

  const rows = await db
    .select({
      id: listings.id,
      operation: listings.operation,
      price: listings.price,
      currency: listings.currency,
      title: listings.title,
      zone: listings.zone,
      bedrooms: listings.bedrooms,
      bathrooms: listings.bathrooms,
      areaM2: listings.areaM2,
      petsAllowed: listings.petsAllowed,
    })
    .from(listings)
    .where(and(...conditions))
    .orderBy(listings.updatedAt)
    .limit(MAX_SEARCH_RESULTS);

  return rows;
}

export interface ListingDetail extends ListingSummary {
  description: string | null;
  maintenanceFee: string | null;
  publicSlug: string | null;
}

/** org + published scoped — a guessed UUID for another org's or an unpublished listing returns null. */
export async function getListingDetails(orgId: string, listingId: string): Promise<ListingDetail | null> {
  const rows = await db
    .select({
      id: listings.id,
      operation: listings.operation,
      price: listings.price,
      currency: listings.currency,
      title: listings.title,
      description: listings.description,
      zone: listings.zone,
      bedrooms: listings.bedrooms,
      bathrooms: listings.bathrooms,
      areaM2: listings.areaM2,
      petsAllowed: listings.petsAllowed,
      maintenanceFee: listings.maintenanceFee,
      publicSlug: listings.publicSlug,
    })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.orgId, orgId), eq(listings.published, true)))
    .limit(1);

  return rows[0] ?? null;
}
