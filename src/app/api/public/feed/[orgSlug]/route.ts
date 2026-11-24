import { NextRequest, NextResponse } from 'next/server';
import { getPublicOrg, listPublicFeedListings } from '@/lib/public/catalog';
import { toPortalFeedXml } from '@/lib/public/feed-xml';
import { getAppOrigin } from '@/lib/widget/origins';
import { getClientIp, publicAssetRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** GET /api/public/feed/[orgSlug] — XML listings feed for real-estate portals. Same visibility rules as /p/<orgSlug>. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<NextResponse> {
  if (!publicAssetRateLimit(getClientIp(request)).success) return new NextResponse(null, { status: 429 });

  const { orgSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  if (!org) return new NextResponse(null, { status: 404 });

  const xml = toPortalFeedXml(await listPublicFeedListings(org.id), {
    origin: originFor(request),
    orgSlug: org.slug,
    orgName: org.name,
  });

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
}

function originFor(request: NextRequest): string {
  try { return getAppOrigin(); } catch { return request.nextUrl.origin; }
}
