import { ImageResponse } from 'next/og';
import { getPublicOrg, getPublicListing } from '@/lib/public/catalog';
import { getAppOrigin } from '@/lib/widget/origins';

export const alt = 'Propiedad';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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

  let backgroundImage: string | null = null;
  if (listing?.coverImageUrl) {
    try {
      const origin = getAppOrigin();
      const res = await fetch(`${origin}${listing.coverImageUrl}`);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const mime = res.headers.get('content-type') ?? 'image/jpeg';
        backgroundImage = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
      }
    } catch {
      backgroundImage = null;
    }
  }

  const title = listing?.title ?? org?.name ?? 'Propiedad';
  const price = listing?.price ? `${listing.currency} ${Number(listing.price).toLocaleString('es-PE')}` : 'Consultar';
  const zone = listing?.zone ?? '';
  const orgName = org?.name ?? '';

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
