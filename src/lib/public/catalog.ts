/**
 * Public catalogue projection (src/app/p/**) — Agent Phase 7, item B.
 *
 * Explicit-column projections only: never select unit_id, property_id,
 * address, owner, tenant or contract data. Published + available listings
 * only, and only for orgs that opted into public pages
 * (agent_configs.public_pages_enabled).
 */

import { db } from '@/lib/db';
import { organizations, listings, unitImages, listingImages, agentConfigs } from '@/lib/db/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getOrgWebChannel } from '@/lib/widget/channel';

/**
 * Read-only — never getOrCreateAgentConfig(), which upserts a row on first
 * read. This runs on every unauthenticated /p/<orgSlug> request, so it must
 * never write: an org with no agent_configs row yet just means public pages
 * are disabled, not "create one and check again".
 */
async function isPublicPagesEnabled(orgId: string): Promise<boolean> {
  const rows = await db
    .select({ publicPagesEnabled: agentConfigs.publicPagesEnabled })
    .from(agentConfigs)
    .where(eq(agentConfigs.orgId, orgId))
    .limit(1);
  return rows[0]?.publicPagesEnabled ?? false;
}

const PAGE_SIZE = 24;
const MAX_DETAIL_IMAGES = 12;

export interface PublicOrg {
  id: string;
  name: string;
  slug: string;
  /** Only set when the org's web widget channel is enabled (Phase 7 decision 4/8). */
  webPublicKey: string | null;
}

export interface PublicListingCard {
  slug: string;
  title: string | null;
  operation: 'rent' | 'sale';
  price: string | null;
  currency: string;
  zone: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: string | null;
  coverImageUrl: string | null;
}

export interface PublicListingDetail extends PublicListingCard {
  description: string | null;
  parking: boolean;
  maintenanceFee: string | null;
  petsAllowed: boolean | null;
  refCode: string | null;
  /** At most 12, cover first then sort_order. */
  imageUrls: string[];
}

/** `/api/public/listing-image/[imageId]` route — a stable redirect to a fresh signed Tigris URL. */
export function publicImageUrl(imageId: string, src: 'unit' | 'listing'): string {
  return `/api/public/listing-image/${imageId}?src=${src}`;
}

/** Null unless the org exists, has a slug, and has opted into public pages. */
export async function getPublicOrg(orgSlug: string): Promise<PublicOrg | null> {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);
  const org = rows[0];
  if (!org || !org.slug) return null;

  if (!(await isPublicPagesEnabled(org.id))) return null;

  const webChannel = await getOrgWebChannel(org.id);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    webPublicKey: webChannel?.enabled ? webChannel.publicKey : null,
  };
}

const listingCardColumns = {
  id: listings.id,
  unitId: listings.unitId,
  publicSlug: listings.publicSlug,
  title: listings.title,
  operation: listings.operation,
  price: listings.price,
  currency: listings.currency,
  zone: listings.zone,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  areaM2: listings.areaM2,
};

/** 24/page. `total` counts all matching rows, not just the returned page. */
export async function listPublicListings(
  orgId: string,
  o: { operation?: 'rent' | 'sale'; page?: number },
): Promise<{ items: PublicListingCard[]; total: number }> {
  const page = Math.max(1, o.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where = and(
    eq(listings.orgId, orgId),
    eq(listings.published, true),
    eq(listings.status, 'available'),
    ...(o.operation ? [eq(listings.operation, o.operation)] : []),
  );

  const [rows, totalRows] = await Promise.all([
    db.select(listingCardColumns).from(listings).where(where).orderBy(desc(listings.createdAt)).limit(PAGE_SIZE).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(listings).where(where),
  ]);

  const covers = await resolveCoverImageUrls(orgId, rows);

  const items: PublicListingCard[] = rows
    .filter((r) => r.publicSlug)
    .map((r) => ({
      slug: r.publicSlug as string,
      title: r.title,
      operation: r.operation as 'rent' | 'sale',
      price: r.price,
      currency: r.currency,
      zone: r.zone,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      areaM2: r.areaM2,
      coverImageUrl: covers.get(r.id) ?? null,
    }));

  return { items, total: Number(totalRows[0]?.count ?? 0) };
}

export async function getPublicListing(orgId: string, slug: string): Promise<PublicListingDetail | null> {
  const rows = await db
    .select({
      id: listings.id,
      unitId: listings.unitId,
      publicSlug: listings.publicSlug,
      title: listings.title,
      operation: listings.operation,
      price: listings.price,
      currency: listings.currency,
      zone: listings.zone,
      bedrooms: listings.bedrooms,
      bathrooms: listings.bathrooms,
      areaM2: listings.areaM2,
      description: listings.description,
      parking: listings.parking,
      maintenanceFee: listings.maintenanceFee,
      petsAllowed: listings.petsAllowed,
      refCode: listings.refCode,
    })
    .from(listings)
    .where(and(
      eq(listings.orgId, orgId),
      eq(listings.publicSlug, slug),
      eq(listings.published, true),
      eq(listings.status, 'available'),
    ))
    .limit(1);

  const row = rows[0];
  if (!row || !row.publicSlug) return null;

  const src: 'unit' | 'listing' = row.unitId ? 'unit' : 'listing';
  const imageIds = row.unitId
    ? (await db
        .select({ id: unitImages.id })
        .from(unitImages)
        .where(and(eq(unitImages.orgId, orgId), eq(unitImages.unitId, row.unitId)))
        .orderBy(desc(unitImages.isCover), asc(unitImages.sortOrder))
        .limit(MAX_DETAIL_IMAGES)).map((i) => i.id)
    : (await db
        .select({ id: listingImages.id })
        .from(listingImages)
        .where(and(eq(listingImages.orgId, orgId), eq(listingImages.listingId, row.id)))
        .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder))
        .limit(MAX_DETAIL_IMAGES)).map((i) => i.id);

  const imageUrls = imageIds.map((id) => publicImageUrl(id, src));

  return {
    slug: row.publicSlug,
    title: row.title,
    operation: row.operation as 'rent' | 'sale',
    price: row.price,
    currency: row.currency,
    zone: row.zone,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    areaM2: row.areaM2,
    coverImageUrl: imageUrls[0] ?? null,
    description: row.description,
    parking: row.parking,
    maintenanceFee: row.maintenanceFee,
    petsAllowed: row.petsAllowed,
    refCode: row.refCode,
    imageUrls,
  };
}

/** Batch cover-image lookup for a page of cards — one query for unit-backed listings, one for standalone ones. Cover first, then sort_order. */
async function resolveCoverImageUrls(
  orgId: string,
  rows: Array<{ id: string; unitId: string | null }>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();

  const unitIds = rows.filter((r) => r.unitId).map((r) => r.unitId as string);
  const listingIds = rows.filter((r) => !r.unitId).map((r) => r.id);

  if (unitIds.length) {
    const imgs = await db
      .select({ id: unitImages.id, unitId: unitImages.unitId })
      .from(unitImages)
      .where(and(eq(unitImages.orgId, orgId), inArray(unitImages.unitId, unitIds)))
      .orderBy(desc(unitImages.isCover), asc(unitImages.sortOrder));
    const coverByUnit = new Map<string, string>();
    for (const img of imgs) {
      if (!coverByUnit.has(img.unitId)) coverByUnit.set(img.unitId, img.id);
    }
    for (const r of rows) {
      if (r.unitId && coverByUnit.has(r.unitId)) urls.set(r.id, publicImageUrl(coverByUnit.get(r.unitId) as string, 'unit'));
    }
  }

  if (listingIds.length) {
    const imgs = await db
      .select({ id: listingImages.id, listingId: listingImages.listingId })
      .from(listingImages)
      .where(and(eq(listingImages.orgId, orgId), inArray(listingImages.listingId, listingIds)))
      .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder));
    const coverByListing = new Map<string, string>();
    for (const img of imgs) {
      if (!coverByListing.has(img.listingId)) coverByListing.set(img.listingId, img.id);
    }
    for (const r of rows) {
      if (!r.unitId && coverByListing.has(r.id)) urls.set(r.id, publicImageUrl(coverByListing.get(r.id) as string, 'listing'));
    }
  }

  return urls;
}
