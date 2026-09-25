export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/public/listing-image/[imageId]?src=unit|listing — Agent Phase 7,
 * item B. A stable URL that survives the widget/OG-crawler round trip;
 * redirects to a fresh 1h signed Tigris URL so no signed URL ever gets baked
 * into rendered HTML. Any failure returns a bare 404 — no detail leaked.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { unitImages, listingImages, listings } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage/index';
import { getOrCreateAgentConfig } from '@/lib/agent/config';
import { publicAssetRateLimit, getClientIp } from '@/lib/ratelimit';

const QuerySchema = z.object({ src: z.enum(['unit', 'listing']) });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
): Promise<NextResponse> {
  const ip = getClientIp(request);
  const rl = publicAssetRateLimit(ip);
  if (!rl.success) return notFound(429);

  const { imageId } = await params;
  if (!z.string().uuid().safeParse(imageId).success) return notFound(404);

  const parsedQuery = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsedQuery.success) return notFound(404);

  try {
    const resolved = await resolvePublicImage(imageId, parsedQuery.data.src);
    if (!resolved) return notFound(404);

    const url = await getSignedUrl(resolved.bucket, resolved.path, 3600);
    const response = NextResponse.redirect(url, 302);
    response.headers.set('Cache-Control', 'public, max-age=600');
    return response;
  } catch {
    return notFound(404);
  }
}

function notFound(status: 404 | 429): NextResponse {
  return new NextResponse(null, { status });
}

async function resolvePublicImage(
  imageId: string,
  src: 'unit' | 'listing',
): Promise<{ bucket: string; path: string } | null> {
  if (src === 'unit') {
    const rows = await db
      .select({ path: unitImages.storagePath, orgId: unitImages.orgId, unitId: unitImages.unitId })
      .from(unitImages)
      .where(eq(unitImages.id, imageId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const listingRows = await db
      .select({ published: listings.published, status: listings.status })
      .from(listings)
      .where(and(eq(listings.orgId, row.orgId), eq(listings.unitId, row.unitId)))
      .limit(1);
    const listing = listingRows[0];
    if (!listing || !listing.published || listing.status !== 'available') return null;
    if (!(await isPublicEligible(row.orgId))) return null;

    return { bucket: 'unit-images', path: row.path };
  }

  const rows = await db
    .select({ path: listingImages.storagePath, orgId: listingImages.orgId, listingId: listingImages.listingId })
    .from(listingImages)
    .where(eq(listingImages.id, imageId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const listingRows = await db
    .select({ published: listings.published, status: listings.status })
    .from(listings)
    .where(and(eq(listings.id, row.listingId), eq(listings.orgId, row.orgId)))
    .limit(1);
  const listing = listingRows[0];
  if (!listing || !listing.published || listing.status !== 'available') return null;
  if (!(await isPublicEligible(row.orgId))) return null;

  return { bucket: 'listing-images', path: row.path };
}

/** public_pages_enabled OR the web channel is switched on — either surface may link to this image. */
async function isPublicEligible(orgId: string): Promise<boolean> {
  const config = await getOrCreateAgentConfig(orgId);
  if (config.publicPagesEnabled) return true;
  return config.channelsEnabled.web && config.widgetAllowedOrigins.length > 0;
}
