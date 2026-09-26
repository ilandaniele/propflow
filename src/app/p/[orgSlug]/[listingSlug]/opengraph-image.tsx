import { headers } from 'next/headers';
import { ImageResponse } from 'next/og';
import { getPublicOrg, getPublicListing } from '@/lib/public/catalog';
import { getAppOrigin } from '@/lib/widget/origins';
import { publicAssetRateLimit, getClientIp } from '@/lib/ratelimit';

export const alt = 'Propiedad';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Crawlers/scrapers keep re-fetching the same OG image for the same URL —
// cache the render for 10 minutes instead of regenerating (and re-fetching
// the cover) on every request.
export const revalidate = 600;

const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB

/** Generic dark card, no cover — used when rate-limited or the cover can't be fetched safely. */
function placeholderImage(title: string, price: string, zone: string, orgName: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundColor: '#0f172a',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '48px',
            background: 'linear-gradient(to top, rgba(15,23,42,0.92), rgba(15,23,42,0.15))',
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 700, color: 'white', display: 'flex' }}>{title}</div>
          <div style={{ fontSize: 32, color: '#e2e8f0', display: 'flex', marginTop: 12 }}>
            {price}{zone ? ` · ${zone}` : ''}
          </div>
          {orgName && (
            <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex', marginTop: 8 }}>{orgName}</div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}

/**
 * Downloads the cover image with a hard 5 MB cap — checked against
 * Content-Length up front (when present) and enforced again while streaming
 * (a lying/missing header can't bypass the cap), since this fetch runs
 * unauthenticated and on a schedule the org doesn't control (crawler
 * re-fetches).
 */
async function fetchCoverAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_COVER_BYTES) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_COVER_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * WhatsApp link previews and social crawlers fetch this long after render,
 * so it can't embed a signed URL baked at page-render time — it fetches the
 * cover image itself, through the same stable redirect route the page uses
 * (Phase 7 decision 9), following the 302 to a fresh signed URL.
 */
export default async function Image({ params }: { params: Promise<{ orgSlug: string; listingSlug: string }> }) {
  const { orgSlug, listingSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  const listing = org ? await getPublicListing(org.id, listingSlug) : null;

  const title = listing?.title ?? org?.name ?? 'Propiedad';
  const price = listing?.price ? `${listing.currency} ${Number(listing.price).toLocaleString('es-PE')}` : 'Consultar';
  const zone = listing?.zone ?? '';
  const orgName = org?.name ?? '';

  const headersList = await headers();
  const ip = getClientIp({ headers: headersList } as unknown as Request);
  const rl = publicAssetRateLimit(ip);
  if (!rl.success) {
    return placeholderImage(title, price, zone, orgName);
  }

  let backgroundImage: string | null = null;
  if (listing?.coverImageUrl) {
    const origin = getAppOrigin();
    backgroundImage = await fetchCoverAsDataUrl(`${origin}${listing.coverImageUrl}`);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundColor: '#0f172a',
          backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '48px',
            background: 'linear-gradient(to top, rgba(15,23,42,0.92), rgba(15,23,42,0.15))',
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 700, color: 'white', display: 'flex' }}>{title}</div>
          <div style={{ fontSize: 32, color: '#e2e8f0', display: 'flex', marginTop: 12 }}>
            {price}{zone ? ` · ${zone}` : ''}
          </div>
          {orgName && (
            <div style={{ fontSize: 24, color: '#94a3b8', display: 'flex', marginTop: 8 }}>{orgName}</div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
